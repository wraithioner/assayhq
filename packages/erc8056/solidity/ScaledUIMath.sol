// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ScaledUIMath
/// @notice On-chain twin of the TypeScript `@assayhq/erc8056` conversion math.
///         ERC-8056 stock tokens do not rebase: `balanceOf`/`totalSupply` (the
///         "raw" amount) are fixed, and the number of underlying shares a raw
///         amount represents is scaled by an 18-decimal UI multiplier.
/// @dev    Semantics match the TypeScript reference exactly (floor / truncating
///         division). Keep the two in lockstep; the TS package has the property
///         tests that pin these invariants.
library ScaledUIMath {
    /// @notice 18-decimal fixed point; 1e18 == a multiplier of 1.0.
    uint256 internal constant WAD = 1e18;

    error NonPositiveMultiplier();

    /// @notice Raw token amount -> underlying shares. Floors.
    /// @dev    underlying = rawAmount * uiMultiplier / 1e18
    function toUnderlyingShares(uint256 rawAmount, uint256 uiMultiplier)
        internal
        pure
        returns (uint256)
    {
        if (uiMultiplier == 0) revert NonPositiveMultiplier();
        return (rawAmount * uiMultiplier) / WAD;
    }

    /// @notice Underlying shares -> raw token amount. Floors.
    /// @dev    raw = uiAmount * 1e18 / uiMultiplier. Inverse of
    ///         {toUnderlyingShares} up to a bounded truncation error.
    function fromUnderlyingShares(uint256 uiAmount, uint256 uiMultiplier)
        internal
        pure
        returns (uint256)
    {
        if (uiMultiplier == 0) revert NonPositiveMultiplier();
        return (uiAmount * WAD) / uiMultiplier;
    }
}
