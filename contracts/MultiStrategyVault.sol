// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MultiStrategyVault
 * @notice ERC-4626 compliant vault that routes capital to multiple underlying strategies
 * @dev Implements withdrawal queue for protocol with lockup periods
 */

contract MultiStrategyVault is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    uint256 public constant MAX_ALLOCATION_BPS = 6000; // 60% max per protocol
    uint256 public constant BPS_DENOMINATOR = 10000;

    struct Strategy {
        address strategyAddress;
        uint256 allocationBps; // Basis points (100 = 1%)
        bool isERC4626;
        bool hasLockup;
        bool isActive;
    }

    struct WithdrawalRequest {
        uint256 shares;
        uint256 assets;
        uint256 timestamp;
        bool completed;
    }

    Strategy[] public strategies;
    mapping (address => WithdrawalRequest[]) public withdrawalQueue;

    uint256 public totalQueuedWithdrawals;
    uint256 public _cachedTotalAssets;
    uint256 public _lastUpdateTimestamp;

    // ============ Events ============
    event StrategyAdded(address indexed strategy, uint256 allocationBps, bool isERC4626, bool hasLockup);
    event StrategyUpdated(uint256 indexed strategyId, uint256 newAllocationBps);
    event StrategyRemoved(uint256 indexed strategyId);
    event Rebalanced(uint256 timestamp);
    event WithdrawalQueued(address indexed user, uint256 shares, uint256 assets, uint256 requestId);
    event WithdrawalCompleted(address indexed user, uint256 requestId, uint256 assets);
    event YieldAccrued(uint256 previousTotal, uint256 newTotal, uint256 yieldAmount);

    // ============ Errors ============
    error InvalidAllocation();
    error AllocationExceedsMax();
    error TotalAllocationInvalid();
    error StrategyNotActive();
    error WithdrawalNotReady();
    error NoWithdrawalRequest();
    error InvalidStrategyIndex();

    // ============ Constructor ============
    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol
    ) ERC4626(_asset) ERC20(_name, _symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }

    // ============ Strategy Management ============

    /**
     * @notice Adds a new strategy to the vault
     * @param strategyAddress Address of the strategy contract
     * @param allocationBps Allocation in basis points
     * @param isERC4626 Whether the strategy is ERC4626 compliant
     * @param hasLockup Whether the strategy has a lockup period
    */

    function addStrategy(
        address strategyAddress,
        uint256 allocationBps,
        bool isERC4626,
        bool hasLockup
    ) external onlyRole(MANAGER_ROLE) {
        if (allocationBps > MAX_ALLOCATION_BPS) revert AllocationExceedsMax();
        if (strategyAddress == address(0)) revert InvalidAllocation();

        // Verify total allocation doesn't exceed 100%
        uint256 totalAllocation = allocationBps;
        for (uint256 i = 0; i < strategies.length; i++) {
            if (strategies[i].isActive) {
                totalAllocation += strategies[i].allocationBps;
            }
        }
        if (totalAllocation > BPS_DENOMINATOR) revert TotalAllocationInvalid();

        strategies.push(Strategy({
            strategyAddress: strategyAddress,
            allocationBps: allocationBps,
            isERC4626: isERC4626,
            hasLockup: hasLockup,
            isActive: true
        }));

        emit StrategyAdded(strategyAddress, allocationBps, isERC4626, hasLockup);
    }

    /**
     * @notice Update strategy allocation
    */

   function updateStrategyAllocation(uint256 strategyId, uint256 newAllocationBps) external onlyRole(MANAGER_ROLE) {
    if (strategyId >= strategies.length) revert InvalidStrategyIndex();
    if (newAllocationBps > MAX_ALLOCATION_BPS) revert AllocationExceedsMax();

    Strategy storage strategy = strategies[strategyId];
    if (!strategy.isActive) revert StrategyNotActive();

    // Verify total allocation
    uint256 totalAllocation = newAllocationBps;
    for (uint256 i = 0; i < strategies.length;  i++) {
        if (i != strategyId && strategies[i].isActive) {
            totalAllocation += strategies[i].allocationBps;
        }        
    }
    if (totalAllocation > BPS_DENOMINATOR) revert TotalAllocationInvalid();

    strategy.allocationBps = newAllocationBps;
    emit StrategyUpdated(strategyId, newAllocationBps);
   }

   /**
    * @notice Remove a strategy (sets to inactive)
   */
    function removeStrategy(uint256 strategyId) external onlyRole(MANAGER_ROLE) {
        if (strategyId >= strategies.length) revert InvalidStrategyIndex();

        strategies[strategyId].isActive = false;
        emit StrategyRemoved(strategyId);
    }

    // ============ Rebalancing ============

    /**
     * @notice Rebalance assets across strategies according to allocations
    */

   function rebalance() external onlyRole(MANAGER_ROLE) nonReentrant whenNotPaused {
       uint256 vaultTotalAssets = totalAssets();
       uint256 availableAssets = IERC20(asset()).balanceOf(address(this));

       // Withdraw from strategies if needed
        for (uint256 i = 0; i < strategies.length; i++) {
            Strategy memory strategy = strategies[i];
            if (!strategy.isActive) continue;

            uint256 targetAmount = (vaultTotalAssets * strategy.allocationBps) / BPS_DENOMINATOR;
            uint256 currentAmount = _getStrategyBalance(i);

            if (currentAmount > targetAmount) {
                uint256 withdrawAmount = currentAmount - targetAmount;
                _withdrawFromStrategy(i, withdrawAmount);
            }
        }

        // Update available assets after withdrawals
        availableAssets = IERC20(asset()).balanceOf(address(this));

        // Deposit to strategies
        for (uint256 i = 0; i < strategies.length; i++) {
            Strategy memory strategy = strategies[i];
            if (!strategy.isActive) continue;

            uint256 targetAmount = (vaultTotalAssets * strategy.allocationBps) / BPS_DENOMINATOR;
            uint256 currentAmount = _getStrategyBalance(i);

            if (currentAmount < targetAmount && availableAssets > 0) {
                uint256 depositAmount = targetAmount - currentAmount;
                if (depositAmount > availableAssets) {
                    depositAmount = availableAssets;
                } 
                _depositToStrategy(i, depositAmount);
                availableAssets -= depositAmount;
            }
        }

         emit Rebalanced(block.timestamp);            
   }

   // ============ Deposit/Withdraw Functions ============

   /**
    * @notice Deposit assets and receive shares
    */

    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        shares = super.deposit(assets, receiver);
        _updateTotalAssetsCache();
    }

    /**
     * @notice Mint shares by depositing assets
    */

   function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        assets = super.mint(shares, receiver);
        _updateTotalAssetsCache();
    }

    /**
     * @notice Withdraw assets by burning shares
     * @dev Routes to instant withdrawal or queued withdrawal based on liquidity
    */

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        uint256 availableLiquidity = IERC20(asset()).balanceOf(address(this));

        if (availableLiquidity >= assets) {
            // Instant withdrawal
            shares = super.withdraw(assets, receiver, owner);
            _updateTotalAssetsCache();
        } else {
            // Queue withdrawal
            shares = previewWithdraw(assets);
            _queueWithdrawal(owner, shares, assets);
        } 
        return shares; 
    }

    /**
     * @notice Redeem shares for assets
    */

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        assets = previewRedeem(shares);
        uint256 availableLiquidity = IERC20(asset()).balanceOf(address(this));

        if (availableLiquidity >= assets) {
            // Instant withdrawal
            assets = super.redeem(shares, receiver, owner);
            _updateTotalAssetsCache();
        } else {
            // Queue withdrawal
            _queueWithdrawal(owner, shares, assets);
        }

        return assets;
    }

    // ============ Withdrawal Queue Functions ============

    /**
     * @notice Queue a withdrawal request
    */

    function _queueWithdrawal(address user, uint256 shares, uint256 assets) internal {
        if (msg.sender != user) {
            uint256 allowed = allowance(user, msg.sender);
            if (allowed != type(uint256).max) {
                _approve(user, msg.sender, allowed - shares);
            }
        }

        _burn(user, shares);

        withdrawalQueue[user].push(WithdrawalRequest({
            shares: shares,
            assets: assets,
            timestamp: block.timestamp,
            completed: false
        }));

        totalQueuedWithdrawals += assets;

        emit WithdrawalQueued(user, shares, assets, withdrawalQueue[user].length - 1);
    }

    /**
     * @notice Complete a queued withdrawal
    */
    function completeWithdrawal(uint256 requestId) external nonReentrant {
        WithdrawalRequest[] storage requests = withdrawalQueue[msg.sender];
        if (requestId >= requests.length) revert NoWithdrawalRequest();

        WithdrawalRequest storage request = requests[requestId];
        if (request.completed) revert WithdrawalNotReady();

        uint256 availableAssets = IERC20(asset()).balanceOf(address(this));
        if (availableAssets < request.assets) revert WithdrawalNotReady();

        request.completed = true;
        totalQueuedWithdrawals -= request.assets;

        IERC20(asset()).safeTransfer(msg.sender, request.assets);

        emit WithdrawalCompleted(msg.sender, requestId, request.assets);
    }

    /**
     * @notice Get pending withdrawal requests for a user
    */

    function getPendingWithdrawals(address user) external view returns (WithdrawalRequest[] memory) {
        return withdrawalQueue[user];
    }

    // ============ Asset Accounting ============

    /**
     * @notice Calculate total assets under management
     * @dev Sum vault balance +  all strategy balances
    */

    function totalAssets() public view override returns (uint256) {
        uint256 total = IERC20(asset()).balanceOf(address(this));

        for (uint256 i = 0; i < strategies.length; i++) {
            if (strategies[i].isActive) {
                total += _getStrategyBalance(i);
            }
        }

        return total;
    }

    /**
     * @notice Get balance in a specific strategy
    */

    function _getStrategyBalance(uint256 strategyId) internal view returns (uint256) {
        Strategy memory strategy = strategies[strategyId];

        if (strategy.isERC4626) {
            IERC4626 strategyVault = IERC4626(strategy.strategyAddress);
            uint256 shares = strategyVault.balanceOf(address(this));
            return strategyVault.convertToAssets(shares);
        } else {
            return IERC20(strategy.strategyAddress).balanceOf(address(this));
        }
    }

    /**
     * @notice Update cached total assets and emit yield if changed 
    */

    function _updateTotalAssetsCache() internal {
        uint256 previousTotal = _cachedTotalAssets;
        uint256 newTotal = totalAssets();

        if (newTotal != previousTotal && previousTotal > 0) {
            uint256 yieldAmount = newTotal > previousTotal ? newTotal - previousTotal: 0;
            emit YieldAccrued(previousTotal, newTotal, yieldAmount);
        }

        _cachedTotalAssets = newTotal;
        _lastUpdateTimestamp = block.timestamp;
    }

    // ============ Strategy Interaction ============
    
    /**
     * @notice Deposit assets to a strategy
    */

    function _depositToStrategy(uint256 strategyId, uint256 amount) internal {
        Strategy memory strategy = strategies[strategyId];
        IERC20 assetToken = IERC20(asset());

        assetToken.forceApprove(strategy.strategyAddress, amount);

        if (strategy.isERC4626) {
            IERC4626(strategy.strategyAddress).deposit(amount, address(this));
        } else {
            assetToken.safeTransfer(strategy.strategyAddress, amount);
        }
    }

    /**
     * @notice Withdraw assets from a strategy
    */

    function _withdrawFromStrategy(uint256 strategyId, uint256 amount) internal {
        Strategy memory strategy = strategies[strategyId];

        if (strategy.isERC4626) {
            IERC4626 strategyVault = IERC4626(strategy.strategyAddress);
            uint256 shares = strategyVault.convertToShares(amount);
            strategyVault.redeem(shares, address(this), address(this));
        } else {
            // For non-ERC4626 strategies, implement custom withdrawal logic
        }
    }

    // ============ Admin Functions ============
    /**
     * @notice Pause contract operations
    */

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause contract operations
    */

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Emergency withdraw all funds from strategies
    */

    function emergencyWithdrawAll() external onlyRole(DEFAULT_ADMIN_ROLE) whenPaused {
        for (uint256 i = 0; i < strategies.length; i++) {
            if (strategies[i].isActive) {
                uint256 balance = _getStrategyBalance(i);
                if (balance > 0) {
                    _withdrawFromStrategy(i, balance);
                }
            }
        }
    }

    // ============ View Functions ============
    
    /**
     * @notice Get all active strategies
    */

    function getStrategies() external view returns (Strategy[] memory) {
        return strategies;
    }

    /**
     * @notice Get strategy count
    */

    function getStrategyCount() external view returns (uint256) {
        return strategies.length;
    }

    /**
     * @notice Get vault performance metrics
    */

    function getVaultMetrics() external view returns (
        uint256 totalAssetsAmount, 
        uint256 totalSharesAmount,
        uint256 pricePerShare,
        uint256 queuedWithdrawals
    ) {
        totalAssetsAmount = totalAssets();
        totalSharesAmount = totalSupply();
        pricePerShare = totalSharesAmount > 0 ? (totalAssetsAmount * 1e18) / totalSharesAmount : 1e18;
        queuedWithdrawals = totalQueuedWithdrawals;
    }
}
