require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-verify");
require('dotenv').config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      timeout: 60000
    },
    
    hyperevm_testnet: {
      url: process.env.HYPEREVM_TESTNET_RPC || "https://api.hyperliquid-testnet.xyz/evm",
      chainId: 998,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 1000000000,
      timeout: 120000,
      httpHeaders: {
        "Content-Type": "application/json"
      }
    },
    
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      chainId: 11155111,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      timeout: 120000
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    customChains: [
      {
        network: "hyperevm_testnet",
        chainId: 998,
        urls: {
          apiURL: "https://explorer.hyperliquid-testnet.xyz/api",
          browserURL: "https://explorer.hyperliquid-testnet.xyz"
        }
      }
    ]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 40000
  }
};