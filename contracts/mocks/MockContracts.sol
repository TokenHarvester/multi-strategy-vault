// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/**
 * @title MockUSDC
 * @notice Mock USDC token for testing
*/

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {
        _mint(msg.sender, 1_000_000 * 10 ** 6); // Mint 1 million USDC         
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title MockERC4626Strategy
 * @notice Mock ERC4626 compliant strategy for testing
*/

contract MockERC4626Strategy is ERC4626 {
    uint256 private _yieldMultiplier = 1e18; // 1.0x initially

    constructor(IERC20 _asset, string memory _name, string memory _symbol) 
        ERC4626(_asset) 
        ERC20(_name, _symbol) 
    {}
        
    /**
     * @notice Simulate yield generation by increasing the multiplier
     * @param bps Basis points to increase (100 = 1%)
    */

    function simulateYield(uint256 bps) external {
        _yieldMultiplier = _yieldMultiplier * (10000 + bps) / 10000;
    }

    /**
     * @notice Override totalAssets to apply yield multiplier
    */

    function totalAssets() public view override returns (uint256) {
        uint256 baseAssets = IERC20(asset()).balanceOf(address(this));
        return (baseAssets * _yieldMultiplier) / 1e18;
    }

    /**
     * @notice Get current yield multiplier
    */

    function getYieldMultiplier() external view returns (uint256) {
        return _yieldMultiplier;
    }
}

/**
 * @title MockLockedStrategy
 * @notice Mock strategy with lockup period for testing withdrawal queue
*/

contract MockLockedStrategy is ERC4626 {
    uint256 public constant LOCKUP_PERIOD = 7 days;
    uint256 private _yieldMultiplier = 1e18;

    mapping (address => uint256) public depositTimestamp;
    mapping (address => uint256) public pendingWithdrawals;

    event WithdrawalQueued(address indexed user, uint256 shares, uint256 unlockTime);
    event WithdrawalProcessed(address indexed user, uint256 assets);

    constructor(IERC20 _asset, string memory _name, string memory _symbol) 
        ERC4626(_asset) 
        ERC20(_name, _symbol) 
    {}
        
    /**
     * @notice Override deposit to track timestamp
    */

    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        shares = super.deposit(assets, receiver);
        depositTimestamp[receiver] = block.timestamp;
    }

    /**
     * @notice Override withdraw to enforce lockup
    */

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares) {
        require(block.timestamp >= depositTimestamp[owner] + LOCKUP_PERIOD, "Funds locked");
        return super.redeem(shares, receiver, owner);
    }

    /**
     * @notice Override redeem to enforce lockup
     */

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        returns (uint256 assets)
    {
        require(
            block.timestamp >= depositTimestamp[owner] + LOCKUP_PERIOD,
            "Funds locked"
        );
        return super.redeem(shares, receiver, owner);
    }

    /**
     * @notice Queue a withdrawal that will be available after lockup
    */

    function queueWithdrawal(uint256 shares) external {
        require(balanceOf(msg.sender) >= shares, "Insufficient shares");
        pendingWithdrawals[msg.sender] += shares;
        _transfer(msg.sender, address(this), shares);

        emit WithdrawalQueued(msg.sender, shares, depositTimestamp[msg.sender] + LOCKUP_PERIOD);
    }

    /**
     * @notice Process queued withdrawals after lockup period
    */

    function processWithdrawal() external returns (uint256 assets) {
        require(block.timestamp >= depositTimestamp[msg.sender] + LOCKUP_PERIOD, "Lockup period not ended");

        uint256 shares = pendingWithdrawals[msg.sender];
        require(shares > 0, "No pending withdrawals");

        pendingWithdrawals[msg.sender] = 0;
        assets = convertToAssets(shares);

        _burn(address(this), shares);
        IERC20(asset()).transfer(msg.sender, assets);

        emit WithdrawalProcessed(msg.sender, assets);
    }

    /**
     * @notice Simulate yield generation
     */

    function simulateYield(uint256 bps) external {
        _yieldMultiplier = _yieldMultiplier * (10000 + bps) / 10000;
    }

    /**
     * @notice Override totalAssets to apply yield multiplier
    */

    function totalAssets() public view override returns (uint256) {
        uint256 baseAssets = IERC20(asset()).balanceOf(address(this));
        return (baseAssets * _yieldMultiplier) / 1e18;
    }
}

/**
 * @title MockHLPStrategy
 * @notice Mock HyperLiquid Perptual strategy (non-ERC4626)
*/

contract MockHLPStrategy is ERC20 {
    IERC20 public immutable asset;
    uint256 private _totalAssets;
    uint256 private _yieldMultiplier = 1e18;

    constructor(IERC20 _asset) ERC20("Mock HLP", "mHLP") {
        asset = _asset;
    }

    /**
     * @notice Deposit assets and recieve HLP tokens
    */

    function deposit(uint256 assets) external returns (uint256 shares) {
        require(assets > 0, "Cannot deposit 0");

        shares = totalSupply() == 0
            ? assets
            : (assets * totalSupply()) / _totalAssets;

        asset.transferFrom(msg.sender, address(this), assets);
        _totalAssets += assets;
        _mint(msg.sender, shares);
    }

    /**
     * @notice Withdraw assets by burning HLP tokens
    */

    function withdraw(uint256 shares) external returns (uint256 assets) {
        require(shares > 0, "Cannot withdraw 0");
        require(balanceOf(msg.sender) >= shares, "Insufficient balance");

        assets = (shares * _totalAssets) / totalSupply();

        _burn(msg.sender, shares);
        _totalAssets -= assets;
        asset.transfer(msg.sender, assets);
    }

    /**
     * @notice Simulate yield/trading profits
    */

    function simulateYield(uint256 bps) external {
        _yieldMultiplier = _yieldMultiplier * (10000 + bps) / 10000;
        _totalAssets = (_totalAssets * _yieldMultiplier) / 1e18;
        _yieldMultiplier = 1e18; // reset multiplier after applying
    }

    /**
     * @notice Get total assets under management
    */

    function totalAssets() external view returns (uint256) {
        return _totalAssets;
    }

    /**
     * @notice Convert shares to assets
    */

    function convertToAssets(uint256 shares) public view returns (uint256) {
        require(totalSupply() > 0, "No shares exist");
        return totalSupply() == 0 ? shares : (shares * _totalAssets) / totalSupply();
    }

    /**
     * @notice Convert assets to shares
    */

    function convertToShares(uint256 assets) public view returns (uint256) {
        return totalSupply() == 0 ? assets : (assets * totalSupply()) / _totalAssets;
    } 
}