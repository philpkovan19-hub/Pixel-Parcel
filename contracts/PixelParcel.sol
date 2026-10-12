// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PixelParcel
 * @notice A 50x50 shared canvas of ownable colored parcels on BOT Chain.
 */
contract PixelParcel is Ownable, ReentrancyGuard, Pausable {
    uint16 public constant GRID_SIZE = 50;
    uint16 public constant TOTAL_PARCELS = 2500;
    uint8 public constant MAX_MESSAGE_LEN = 64;
    uint256 public constant MAX_BASE_PRICE = 1 ether;
    uint16 public constant MAX_PLATFORM_FEE_BPS = 1000; // 10%

    struct Parcel {
        address owner;
        uint24 color;
        uint256 listedPrice;
        string message;
    }

    mapping(uint16 => Parcel) private _parcels;
    mapping(address => uint16[]) private _ownedParcels;
    mapping(uint16 => uint256) private _ownedIndex; // parcelId => index+1 in owner's array

    uint256 public parcelBasePrice = 0.005 ether;
    uint16 public platformFeeBps = 250; // 2.5%
    uint256 public parcelsSold;
    uint256 public totalVolume;
    uint256 public accumulatedFees;

    event ParcelClaimed(uint16 indexed parcelId, address indexed owner, uint24 color, string message);
    event ParcelUpdated(uint16 indexed parcelId, address indexed owner, uint24 color, string message);
    event ParcelListed(uint16 indexed parcelId, address indexed owner, uint256 price);
    event ParcelSold(uint16 indexed parcelId, address indexed from, address indexed to, uint256 price);
    event BasePriceUpdated(uint256 newPrice);
    event PlatformFeeUpdated(uint16 newBps);
    event FeesWithdrawn(address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    // ------------------------------------------------------------------
    // Core
    // ------------------------------------------------------------------

    function claimParcel(uint16 parcelId, uint24 color, string calldata message)
        external
        payable
        whenNotPaused
        nonReentrant
    {
        require(parcelId < TOTAL_PARCELS, "invalid id");
        require(bytes(message).length <= MAX_MESSAGE_LEN, "msg too long");
        require(msg.value >= parcelBasePrice, "insufficient payment");
        Parcel storage p = _parcels[parcelId];
        require(p.owner == address(0), "already claimed");

        p.owner = msg.sender;
        p.color = color;
        p.message = message;

        _addOwned(msg.sender, parcelId);
        parcelsSold += 1;
        accumulatedFees += parcelBasePrice;

        uint256 excess = msg.value - parcelBasePrice;
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            require(ok, "refund failed");
        }

        emit ParcelClaimed(parcelId, msg.sender, color, message);
    }

    function updateParcel(uint16 parcelId, uint24 color, string calldata message)
        external
        whenNotPaused
    {
        require(parcelId < TOTAL_PARCELS, "invalid id");
        require(bytes(message).length <= MAX_MESSAGE_LEN, "msg too long");
        Parcel storage p = _parcels[parcelId];
        require(p.owner == msg.sender, "not owner");
        p.color = color;
        p.message = message;
        emit ParcelUpdated(parcelId, msg.sender, color, message);
    }

    function listForSale(uint16 parcelId, uint256 price) external whenNotPaused {
        require(parcelId < TOTAL_PARCELS, "invalid id");
        Parcel storage p = _parcels[parcelId];
        require(p.owner == msg.sender, "not owner");
        p.listedPrice = price;
        emit ParcelListed(parcelId, msg.sender, price);
    }

    function buyParcel(uint16 parcelId) external payable whenNotPaused nonReentrant {
        require(parcelId < TOTAL_PARCELS, "invalid id");
        Parcel storage p = _parcels[parcelId];
        uint256 price = p.listedPrice;
        require(price > 0, "not for sale");
        require(msg.value >= price, "insufficient payment");
        address seller = p.owner;
        require(seller != address(0) && seller != msg.sender, "invalid seller");

        uint256 fee = (price * platformFeeBps) / 10_000;
        uint256 sellerCut = price - fee;
        accumulatedFees += fee;
        totalVolume += price;

        _removeOwned(seller, parcelId);
        _addOwned(msg.sender, parcelId);
        p.owner = msg.sender;
        p.listedPrice = 0;

        (bool ok, ) = seller.call{value: sellerCut}("");
        require(ok, "seller pay failed");

        uint256 excess = msg.value - price;
        if (excess > 0) {
            (bool ok2, ) = msg.sender.call{value: excess}("");
            require(ok2, "refund failed");
        }

        emit ParcelSold(parcelId, seller, msg.sender, price);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getParcel(uint16 parcelId)
        external
        view
        returns (address owner_, uint24 color, string memory message, uint256 listedPrice)
    {
        require(parcelId < TOTAL_PARCELS, "invalid id");
        Parcel storage p = _parcels[parcelId];
        return (p.owner, p.color, p.message, p.listedPrice);
    }

    function getParcels(uint16[] calldata parcelIds)
        external
        view
        returns (address[] memory owners, uint24[] memory colors, uint256[] memory prices)
    {
        uint256 n = parcelIds.length;
        owners = new address[](n);
        colors = new uint24[](n);
        prices = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            uint16 id = parcelIds[i];
            require(id < TOTAL_PARCELS, "invalid id");
            Parcel storage p = _parcels[id];
            owners[i] = p.owner;
            colors[i] = p.color;
            prices[i] = p.listedPrice;
        }
    }

    function getOwnedParcels(address who) external view returns (uint16[] memory) {
        return _ownedParcels[who];
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setBasePrice(uint256 newPrice) external onlyOwner {
        require(newPrice <= MAX_BASE_PRICE, "exceeds max");
        parcelBasePrice = newPrice;
        emit BasePriceUpdated(newPrice);
    }

    function setPlatformFeeBps(uint16 newBps) external onlyOwner {
        require(newBps <= MAX_PLATFORM_FEE_BPS, "exceeds max");
        platformFeeBps = newBps;
        emit PlatformFeeUpdated(newBps);
    }

    function withdrawFees(address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "zero addr");
        uint256 amount = accumulatedFees;
        require(amount > 0, "nothing to withdraw");
        accumulatedFees = 0;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
        emit FeesWithdrawn(to, amount);
    }

    // ------------------------------------------------------------------
    // Internal ownership tracking
    // ------------------------------------------------------------------

    function _addOwned(address who, uint16 parcelId) internal {
        _ownedParcels[who].push(parcelId);
        _ownedIndex[parcelId] = _ownedParcels[who].length; // +1 offset
    }

    function _removeOwned(address who, uint16 parcelId) internal {
        uint256 idxPlus = _ownedIndex[parcelId];
        require(idxPlus > 0, "not tracked");
        uint256 idx = idxPlus - 1;
        uint16[] storage arr = _ownedParcels[who];
        uint256 lastIdx = arr.length - 1;
        if (idx != lastIdx) {
            uint16 lastId = arr[lastIdx];
            arr[idx] = lastId;
            _ownedIndex[lastId] = idx + 1;
        }
        arr.pop();
        _ownedIndex[parcelId] = 0;
    }

    receive() external payable {
        accumulatedFees += msg.value;
    }
}
