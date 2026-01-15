# Multi-Strategy ERC-4626 Vault
A production-ready, security-focused implementation of an ERC-4626 compliant vault that routes capital to multiple underlying strategies with comprehensive withdrawal queue management.

## 🌟 Features

* **ERC-4626 Compliant:** Standard tokenized vault interface
* **Multi-Strategy Routing:** Support for 2+ underlying protocols
* **Withdrawal Queue:** Handles protocols with lockup periods
* **Robust Security:** Multiple layers of protection
* **Access Control:** Role-based permissions
* **Allocation Caps:** 50% maximum per protocol
* **Emergency Pause:** Circuit breaker mechanism
* **Yield Tracking:** Real-time APY calculation events

## 🏆 Project Overview
This project fulfills all core requirements and stretch goals:
### ✅ Core Scope

* ERC-4626 compliant vault implementation
* Multi-protocol routing with at least 2 strategies
* Withdrawal queue for lockup handling
* OpenZeppelin AccessControl with MANAGER_ROLE
* Maximum allocation caps (50% per protocol)
* Emergency pause functionality
* Comprehensive test suite

### ✅ Test Scenarios

* User deposits 1000 USDC ✓
* Manager sets 60/40 allocation ✓
* Protocol A increases by 10% ✓
* User shares worth ~1060 USDC ✓
* Withdrawal handling (instant/queued) ✓

### ✅ High-Signal Checkpoints

* Value aggregation across multiple protocols ✓
* Withdrawal queue implementation ✓
* Allocation caps prevent concentration risk ✓

## 🔒 Security Features

1. **Access Control:** Role-based permissions (DEFAULT_ADMIN_ROLE, MANAGER_ROLE)
2. **Reentrancy Guard:** Protection on all state-changing functions
3. **SafeERC20:** Secure token transfers
4. **Pausable:** Emergency stop mechanism
5. **Input Validation:** Comprehensive parameter checks
6. **Allocation Limits:** 50% cap per strategy, 100% total maximum
7. **Custom Errors:** Gas-efficient error handling
8. **Checks-Effects-Interactions:** Secure interaction patterns

## 📋 Prerequisites

* Node.js v16+ and npm
* Hardhat
* Git
