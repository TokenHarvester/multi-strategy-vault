const hre = require("hardhat");

async function main() {
    console.log("Starting deployment...\n");
    
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");
    
    // Deploy MockUSDC
    console.log("Deploying MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();
    const usdcAddress = await usdc.getAddress();
    console.log("MockUSDC deployed to:", usdcAddress);
    
    // Deploy Strategy A (ERC4626)
    console.log("\nDeploying Strategy A (MockERC4626Strategy)...");
    const MockERC4626Strategy = await ethers.getContractFactory("MockERC4626Strategy");
    const strategyA = await MockERC4626Strategy.deploy(
        usdcAddress,
        "Strategy A - Yield Optimizer",
        "STRA"
    );
    await strategyA.waitForDeployment();
    const strategyAAddress = await strategyA.getAddress();
    console.log("Strategy A deployed to:", strategyAAddress);
    
    // Deploy Strategy B (Locked Strategy)
    console.log("\nDeploying Strategy B (MockLockedStrategy)...");
    const MockLockedStrategy = await ethers.getContractFactory("MockLockedStrategy");
    const strategyB = await MockLockedStrategy.deploy(
        usdcAddress,
        "Strategy B - Locked Staking",
        "STRB"
    );
    await strategyB.waitForDeployment();
    const strategyBAddress = await strategyB.getAddress();
    console.log("Strategy B deployed to:", strategyBAddress);
    
    // Deploy MultiStrategyVault
    console.log("\nDeploying MultiStrategyVault...");
    const MultiStrategyVault = await ethers.getContractFactory("MultiStrategyVault");
    const vault = await MultiStrategyVault.deploy(
        usdcAddress,
        "Multi Strategy Vault",
        "MSV"
    );
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();
    console.log("MultiStrategyVault deployed to:", vaultAddress);
    
    // Setup strategies in vault
    console.log("\nSetting up strategies in vault...");
    
    console.log("Adding Strategy A (60% allocation)...");
    let tx = await vault.addStrategy(
        strategyAAddress,
        6000, // 60%
        true,  // isERC4626
        false  // hasLockup
    );
    await tx.wait();
    console.log("Strategy A added");
    
    console.log("Adding Strategy B (40% allocation)...");
    tx = await vault.addStrategy(
        strategyBAddress,
        4000, // 40%
        true,  // isERC4626
        true   // hasLockup
    );
    await tx.wait();
    console.log("Strategy B added");
    
    // Print deployment summary
    console.log("\n=================================");
    console.log("DEPLOYMENT SUMMARY");
    console.log("=================================");
    console.log("Network:", hre.network.name);
    console.log("Deployer:", deployer.address);
    console.log("\nContract Addresses:");
    console.log("-----------------------------------");
    console.log("MockUSDC:", usdcAddress);
    console.log("Strategy A:", strategyAAddress);
    console.log("Strategy B:", strategyBAddress);
    console.log("MultiStrategyVault:", vaultAddress);
    console.log("=================================\n");
    
    // Save deployment info
    const deploymentInfo = {
        network: hre.network.name,
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        contracts: {
            mockUSDC: usdcAddress,
            strategyA: strategyAAddress,
            strategyB: strategyBAddress,
            vault: vaultAddress
        }
    };
    
    const fs = require('fs');
    fs.writeFileSync(
        'deployment-info.json',
        JSON.stringify(deploymentInfo, null, 2)
    );
    console.log("Deployment info saved to deployment-info.json\n");
    
    // Verify contracts on explorer (if not localhost)
    if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
        console.log("Waiting for block confirmations before verification...");
        await tx.wait(6);
        
        console.log("\nVerifying contracts on explorer...");
        
        try {
            await hre.run("verify:verify", {
                address: usdcAddress,
                constructorArguments: []
            });
            console.log("MockUSDC verified");
        } catch (error) {
            console.log("MockUSDC verification failed:", error.message);
        }
        
        try {
            await hre.run("verify:verify", {
                address: strategyAAddress,
                constructorArguments: [usdcAddress, "Strategy A - Yield Optimizer", "STRA"]
            });
            console.log("Strategy A verified");
        } catch (error) {
            console.log("Strategy A verification failed:", error.message);
        }
        
        try {
            await hre.run("verify:verify", {
                address: strategyBAddress,
                constructorArguments: [usdcAddress, "Strategy B - Locked Staking", "STRB"]
            });
            console.log("Strategy B verified");
        } catch (error) {
            console.log("Strategy B verification failed:", error.message);
        }
        
        try {
            await hre.run("verify:verify", {
                address: vaultAddress,
                constructorArguments: [usdcAddress, "Multi Strategy Vault", "MSV"]
            });
            console.log("MultiStrategyVault verified");
        } catch (error) {
            console.log("MultiStrategyVault verification failed:", error.message);
        }
    }
    
    console.log("\nDeployment complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });