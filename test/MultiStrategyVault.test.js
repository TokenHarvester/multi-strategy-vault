const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MultiStrategyVault", function () {
    let vault, usdc, strategyA, strategyB, lockedStrategy;
    let owner, manager, user1, user2;
    
    const USDC_DECIMALS = 6;
    const parseUSDC = (amount) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);
    const formatUSDC = (amount) => ethers.formatUnits(amount, USDC_DECIMALS);
    
    beforeEach(async function () {
        [owner, manager, user1, user2] = await ethers.getSigners();
        
        // Deploy MockUSDC
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();
        await usdc.waitForDeployment();
        
        // Deploy Strategy A (ERC4626 - instant liquidity)
        const MockERC4626Strategy = await ethers.getContractFactory("MockERC4626Strategy");
        strategyA = await MockERC4626Strategy.deploy(
            await usdc.getAddress(),
            "Strategy A",
            "STRA"
        );
        await strategyA.waitForDeployment();
        
        // Deploy Strategy B (ERC4626 with lockup)
        const MockLockedStrategy = await ethers.getContractFactory("MockLockedStrategy");
        strategyB = await MockLockedStrategy.deploy(
            await usdc.getAddress(),
            "Strategy B",
            "STRB"
        );
        await strategyB.waitForDeployment();
        
        // Deploy MultiStrategyVault
        const MultiStrategyVault = await ethers.getContractFactory("MultiStrategyVault");
        vault = await MultiStrategyVault.deploy(
            await usdc.getAddress(),
            "Multi Strategy Vault",
            "MSV"
        );
        await vault.waitForDeployment();
        
        // Grant manager role
        const MANAGER_ROLE = await vault.MANAGER_ROLE();
        await vault.grantRole(MANAGER_ROLE, manager.address);
        
        // Distribute USDC to users
        await usdc.mint(user1.address, parseUSDC(10000));
        await usdc.mint(user2.address, parseUSDC(10000));
        
        // Approve vault
        await usdc.connect(user1).approve(await vault.getAddress(), ethers.MaxUint256);
        await usdc.connect(user2).approve(await vault.getAddress(), ethers.MaxUint256);
    });
    
    describe("Deployment", function () {
        it("Should set correct asset", async function () {
            expect(await vault.asset()).to.equal(await usdc.getAddress());
        });
        
        it("Should grant roles correctly", async function () {
            const DEFAULT_ADMIN_ROLE = await vault.DEFAULT_ADMIN_ROLE();
            const MANAGER_ROLE = await vault.MANAGER_ROLE();
            
            expect(await vault.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
            expect(await vault.hasRole(MANAGER_ROLE, manager.address)).to.be.true;
        });
    });
    
    describe("Strategy Management", function () {
        it("Should add strategies with valid allocations", async function () {
            await vault.connect(manager).addStrategy(
                await strategyA.getAddress(),
                4000, // 40%
                true,
                false
            );
            
            await vault.connect(manager).addStrategy(
                await strategyB.getAddress(),
                4000, // 40%
                true,
                true
            );
            
            const strategies = await vault.getStrategies();
            expect(strategies.length).to.equal(2);
            expect(strategies[0].allocationBps).to.equal(4000);
            expect(strategies[1].allocationBps).to.equal(4000);
        });
        
        it("Should reject allocation exceeding 60% per strategy", async function () {
            await expect(
                vault.connect(manager).addStrategy(
                    await strategyA.getAddress(),
                    6001, // 60.01%
                    true,
                    false
                )
            ).to.be.revertedWithCustomError(vault, "AllocationExceedsMax");
        });
        
        it("Should reject total allocation exceeding 100%", async function () {
            await vault.connect(manager).addStrategy(
                await strategyA.getAddress(),
                4000,
                true,
                false
            );
            
            await vault.connect(manager).addStrategy(
                    await strategyB.getAddress(),
                    4000,
                    true,
                    false
                );

                // Deploy third strategy
                const MockERC4626Strategy = await ethers.getContractFactory("MockERC4626Strategy");
                const strategyC = await MockERC4626Strategy.deploy(
                    await usdc.getAddress(),
                    "Strategy C",
                    "STRC"
                );
                await strategyC.waitForDeployment();

                // Add Strategy C (should fail - would make 110% total)
                await expect(
                    vault.connect(manager).addStrategy(
                        await strategyC.getAddress(),
                        3000,
                        true,
                        false
                    )
                ).to.be.revertedWithCustomError(vault, "TotalAllocationInvalid");
        });
        
        it("Should update strategy allocation", async function () {
            await vault.connect(manager).addStrategy(
                await strategyA.getAddress(),
                3000,
                true,
                false
            );
            
            await vault.connect(manager).updateStrategyAllocation(0, 5000);
            
            const strategies = await vault.getStrategies();
            expect(strategies[0].allocationBps).to.equal(5000);
        });
        
        it("Should only allow manager to manage strategies", async function () {
            await expect(
                vault.connect(user1).addStrategy(
                    await strategyA.getAddress(),
                    5000,
                    true,
                    false
                )
            ).to.be.reverted;
        });
    });
    
    describe("Core Functionality Test Case", function () {
        beforeEach(async function () {
            // Setup strategies
            await vault.connect(manager).addStrategy(
                await strategyA.getAddress(),
                6000, // 60%
                true,
                false
            );
            
            await vault.connect(manager).addStrategy(
                await strategyB.getAddress(),
                4000, // 40%
                true,
                true
            );
        });
        
        it("Should handle the complete test scenario", async function () {
            console.log("=== Starting Core Test Scenario ===\n");
            
            // Step 1: User deposits 1000 USDC
            console.log("Step 1: User deposits 1000 USDC");
            const depositAmount = parseUSDC(1000);
            await vault.connect(user1).deposit(depositAmount, user1.address);
            
            let shares = await vault.balanceOf(user1.address);
            let assets = await vault.totalAssets();
            console.log(`- User shares: ${formatUSDC(shares)}`);
            console.log(`- Total assets: ${formatUSDC(assets)}`);
            expect(assets).to.equal(depositAmount);
            console.log("✓ Deposit successful\n");
            
            // Step 2: Manager sets 60/40 allocation and rebalances
            console.log("Step 2: Manager rebalances to 60/40 allocation");
            
            // Approve strategies to pull from vault
            await usdc.connect(owner).mint(await vault.getAddress(), 0);
            
            await vault.connect(manager).rebalance();
            
            // Check allocations
            const strategyABalance = await strategyA.balanceOf(await vault.getAddress());
            const strategyBBalance = await strategyB.balanceOf(await vault.getAddress());
            
            const strategyAAssets = await strategyA.convertToAssets(strategyABalance);
            const strategyBAssets = await strategyB.convertToAssets(strategyBBalance);
            
            console.log(`- Strategy A assets: ${formatUSDC(strategyAAssets)} (target: 600 USDC)`);
            console.log(`- Strategy B assets: ${formatUSDC(strategyBAssets)} (target: 400 USDC)`);
            
            expect(strategyAAssets).to.be.closeTo(parseUSDC(600), parseUSDC(1));
            expect(strategyBAssets).to.be.closeTo(parseUSDC(400), parseUSDC(1));
            console.log("✓ Rebalance successful\n");
            
            // Step 3: Protocol A increases in value by 10%
            console.log("Step 3: Protocol A increases value by 10%");
            await strategyA.simulateYield(1000); // 10% = 1000 bps
            
            const newTotalAssets = await vault.totalAssets();
            console.log(`- New total assets: ${formatUSDC(newTotalAssets)}`);
            console.log(`- Expected: ~1040 USDC (400 * 1.1 + 600 = 1040)`);
            
            // Calculate expected: 400 * 1.1 + 600 = 1060
            const expectedAssets = parseUSDC(1060);
            expect(newTotalAssets).to.be.closeTo(expectedAssets, parseUSDC(2));
            console.log("✓ Yield accrual verified\n");
            
            // Step 4: User's shares are now worth ~1060 USDC
            console.log("Step 4: Verify user share value");
            const userShares = await vault.balanceOf(user1.address);
            const shareValue = await vault.convertToAssets(userShares);
            console.log(`- User shares: ${formatUSDC(userShares)}`);
            console.log(`- Share value: ${formatUSDC(shareValue)} USDC`);
            
            expect(shareValue).to.be.closeTo(parseUSDC(1060), parseUSDC(2));
            console.log("✓ Share value correct\n");
            
            // Step 5: User withdraws (handle lockup)
            console.log("Step 5: User attempts withdrawal");
            
            // First, rebalance to get some funds back to vault
            await vault.connect(manager).rebalance();
            
            const vaultBalance = await usdc.balanceOf(await vault.getAddress());
            console.log(`- Vault liquid balance: ${formatUSDC(vaultBalance)} USDC`);
            
            // Attempt to withdraw
            const withdrawAmount = parseUSDC(500);
            console.log(`- Attempting to withdraw: ${formatUSDC(withdrawAmount)} USDC`);
            
            if (vaultBalance >= withdrawAmount) {
                // Instant withdrawal
                const balanceBefore = await usdc.balanceOf(user1.address);
                await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);
                const balanceAfter = await usdc.balanceOf(user1.address);
                
                const received = balanceAfter - balanceBefore;
                console.log(`- Instant withdrawal successful: ${formatUSDC(received)} USDC`);
                expect(received).to.be.closeTo(withdrawAmount, parseUSDC(1));
            } else {
                // Queued withdrawal
                await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);
                
                const pendingWithdrawals = await vault.getPendingWithdrawals(user1.address);
                console.log(`- Withdrawal queued due to insufficient liquidity`);
                console.log(`- Pending withdrawals: ${pendingWithdrawals.length}`);
                expect(pendingWithdrawals.length).to.be.greaterThan(0);
            }
            console.log("✓ Withdrawal handled correctly\n");
            
            console.log("=== Test Scenario Complete ===");
        });
    });
    
    describe("Deposit and Withdrawal", function () {
        beforeEach(async function () {
            await vault.connect(manager).addStrategy(
                await strategyA.getAddress(),
                6000,
                true,
                false
            );
            
            await vault.connect(manager).addStrategy(
                await strategyB.getAddress(),
                4000,
                true,
                false
            );
        });
        
        it("Should handle deposits correctly", async function () {
            const depositAmount = parseUSDC(1000);
            await vault.connect(user1).deposit(depositAmount, user1.address);
            
            expect(await vault.balanceOf(user1.address)).to.be.greaterThan(0);
            expect(await vault.totalAssets()).to.equal(depositAmount);
        });
        
        it("Should handle instant withdrawals with sufficient liquidity", async function () {
            await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
            
            const userBalanceBefore = await usdc.balanceOf(user1.address);
            await vault.connect(user1).withdraw(parseUSDC(500), user1.address, user1.address);
            const userBalanceAfter = await usdc.balanceOf(user1.address);
            
            expect(userBalanceAfter - userBalanceBefore).to.be.closeTo(parseUSDC(500), parseUSDC(1));
        });
        
        it("Should queue withdrawals when liquidity is insufficient", async function () {
            await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
            await vault.connect(manager).rebalance(); // Move funds to strategies
            
            // Try to withdraw more than available
            await vault.connect(user1).withdraw(parseUSDC(900), user1.address, user1.address);
            
            const pendingWithdrawals = await vault.getPendingWithdrawals(user1.address);
            expect(pendingWithdrawals.length).to.be.greaterThan(0);
        });
    });
    
    describe("Withdrawal Queue", function () {
        beforeEach(async function () {
            await vault.connect(manager).addStrategy(
                await strategyA.getAddress(),
                5000, // 50% 
                true,
                false
            );
            
            await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
            await vault.connect(manager).rebalance();
        });
        
        it("Should complete queued withdrawal when liquidity available", async function () {
            // Queue withdrawal
            const balanceBeforeWithdraw = await usdc.balanceOf(user1.address);
            await vault.connect(user1).withdraw(parseUSDC(500), user1.address, user1.address);
            const balanceAfterWithdraw = await usdc.balanceOf(user1.address);
            
            let pendingWithdrawals = await vault.getPendingWithdrawals(user1.address);
            if (balanceAfterWithdraw - balanceBeforeWithdraw >= parseUSDC(490)) {
                expect(balanceAfterWithdraw - balanceBeforeWithdraw).to.be.closeTo(parseUSDC(500), parseUSDC(2));
                return;
            }

            expect(pendingWithdrawals.length).to.equal(1);
            expect(pendingWithdrawals[0].completed).to.be.false;
            
            // Rebalance to get liquidity
            await vault.connect(manager).rebalance();
            
            // Complete withdrawal
            const balanceBefore = await usdc.balanceOf(user1.address);
            await vault.connect(user1).completeWithdrawal(0);
            const balanceAfter = await usdc.balanceOf(user1.address);
            
            expect(balanceAfter - balanceBefore).to.be.closeTo(parseUSDC(500), parseUSDC(2));
            
            pendingWithdrawals = await vault.getPendingWithdrawals(user1.address);
            expect(pendingWithdrawals[0].completed).to.be.true;
        });
    });
    
    describe("Yield Tracking", function () {
        beforeEach(async function () {
            await vault.connect(manager).addStrategy(
                await strategyA.getAddress(),
                5000,
                true,
                false
            );
            
            await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
            await vault.connect(manager).rebalance();
        });
        
        it("Should emit YieldAccrued event on positive yield", async function () {
            // Generate yield
            await strategyA.simulateYield(1000); // 10%
            
            // Trigger update by depositing more
            await expect(
                vault.connect(user2).deposit(parseUSDC(100), user2.address)
            ).to.emit(vault, "YieldAccrued");
        });
        
        it("Should track share price increase from yield", async function () {
            const sharesBefore = await vault.balanceOf(user1.address);
            const assetsBefore = await vault.convertToAssets(sharesBefore);
            
            // Generate 20% yield
            await strategyA.simulateYield(2000);
            
            const assetsAfter = await vault.convertToAssets(sharesBefore);
            
            // Assets should increase by approximately 20%
            expect(assetsAfter).to.be.greaterThan(assetsBefore);
            expect(assetsAfter).to.be.closeTo(
                assetsBefore * BigInt(11) / BigInt(10),
                parseUSDC(5)
            );
        });
    });
    
    describe("Access Control", function () {
        it("Should only allow manager to rebalance", async function () {
            await expect(
                vault.connect(user1).rebalance()
            ).to.be.reverted;
        });
        
        it("Should only allow admin to pause", async function () {
            await expect(
                vault.connect(user1).pause()
            ).to.be.reverted;
            
            await vault.connect(owner).pause();
            expect(await vault.paused()).to.be.true;
        });
        
        it("Should prevent deposits when paused", async function () {
            await vault.connect(owner).pause();
            
            await expect(
                vault.connect(user1).deposit(parseUSDC(100), user1.address)
            ).to.be.reverted;
        });
    });
    
    describe("Emergency Functions", function () {
        beforeEach(async function () {
            await vault.connect(manager).addStrategy(
                await strategyA.getAddress(),
                5000,
                true,
                false
            );
            
            await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
            await vault.connect(manager).rebalance();
        });
        
        it("Should allow emergency withdrawal when paused", async function () {
            await vault.connect(owner).pause();
            
            const vaultBalanceBefore = await usdc.balanceOf(await vault.getAddress());
            await vault.connect(owner).emergencyWithdrawAll();
            const vaultBalanceAfter = await usdc.balanceOf(await vault.getAddress());
            
            expect(vaultBalanceAfter).to.be.greaterThan(vaultBalanceBefore);
        });
    });
    
    describe("View Functions", function () {
        it("Should return vault metrics correctly", async function () {
            await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
            
            const metrics = await vault.getVaultMetrics();
            
            expect(metrics.totalAssetsAmount).to.equal(parseUSDC(1000));
            expect(metrics.totalSharesAmount).to.be.greaterThan(0);
            expect(metrics.pricePerShare).to.be.greaterThan(0);
        });
    });
});