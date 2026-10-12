const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PixelParcel", function () {
  let pp, owner, alice, bob, carol;
  const BASE = ethers.parseEther("0.005");

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const PP = await ethers.getContractFactory("PixelParcel");
    pp = await PP.deploy();
    await pp.waitForDeployment();
  });

  it("claims a parcel with valid params", async function () {
    await expect(pp.connect(alice).claimParcel(42, 0xff00ff, "hello", { value: BASE }))
      .to.emit(pp, "ParcelClaimed").withArgs(42, alice.address, 0xff00ff, "hello");
    const [o, c, m, price] = await pp.getParcel(42);
    expect(o).to.equal(alice.address);
    expect(c).to.equal(0xff00ff);
    expect(m).to.equal("hello");
    expect(price).to.equal(0n);
    expect(await pp.parcelsSold()).to.equal(1n);
  });

  it("rejects claim with insufficient payment", async function () {
    await expect(
      pp.connect(alice).claimParcel(1, 0x000000, "", { value: BASE - 1n })
    ).to.be.revertedWith("insufficient payment");
  });

  it("rejects claim on already-claimed parcel", async function () {
    await pp.connect(alice).claimParcel(7, 0x123456, "a", { value: BASE });
    await expect(
      pp.connect(bob).claimParcel(7, 0x654321, "b", { value: BASE })
    ).to.be.revertedWith("already claimed");
  });

  it("rejects invalid parcelId", async function () {
    await expect(
      pp.connect(alice).claimParcel(2500, 0, "", { value: BASE })
    ).to.be.revertedWith("invalid id");
  });

  it("rejects message > 64 chars", async function () {
    const tooLong = "x".repeat(65);
    await expect(
      pp.connect(alice).claimParcel(1, 0, tooLong, { value: BASE })
    ).to.be.revertedWith("msg too long");
  });

  it("updateParcel is owner-only and mutates state", async function () {
    await pp.connect(alice).claimParcel(10, 0x111111, "one", { value: BASE });
    await expect(pp.connect(bob).updateParcel(10, 0x222222, "no"))
      .to.be.revertedWith("not owner");
    await expect(pp.connect(alice).updateParcel(10, 0x222222, "two"))
      .to.emit(pp, "ParcelUpdated").withArgs(10, alice.address, 0x222222, "two");
    const [, c, m] = await pp.getParcel(10);
    expect(c).to.equal(0x222222);
    expect(m).to.equal("two");
  });

  it("listForSale is owner-only; supports delist with 0", async function () {
    await pp.connect(alice).claimParcel(5, 0, "", { value: BASE });
    await expect(pp.connect(bob).listForSale(5, 100)).to.be.revertedWith("not owner");
    await pp.connect(alice).listForSale(5, ethers.parseEther("0.1"));
    expect((await pp.getParcel(5))[3]).to.equal(ethers.parseEther("0.1"));
    await pp.connect(alice).listForSale(5, 0);
    expect((await pp.getParcel(5))[3]).to.equal(0n);
  });

  it("buyParcel transfers ownership, pays seller minus fee, clears listing", async function () {
    await pp.connect(alice).claimParcel(9, 0xabcdef, "mine", { value: BASE });
    const price = ethers.parseEther("1");
    await pp.connect(alice).listForSale(9, price);

    const sellerBefore = await ethers.provider.getBalance(alice.address);
    await expect(pp.connect(bob).buyParcel(9, { value: price }))
      .to.emit(pp, "ParcelSold").withArgs(9, alice.address, bob.address, price);
    const sellerAfter = await ethers.provider.getBalance(alice.address);

    const fee = (price * 250n) / 10000n;
    expect(sellerAfter - sellerBefore).to.equal(price - fee);

    const [o, , , listed] = await pp.getParcel(9);
    expect(o).to.equal(bob.address);
    expect(listed).to.equal(0n);
    expect(await pp.totalVolume()).to.equal(price);
  });

  it("buyParcel reverts when not listed or underpaid", async function () {
    await pp.connect(alice).claimParcel(2, 0, "", { value: BASE });
    await expect(pp.connect(bob).buyParcel(2, { value: 1 })).to.be.revertedWith("not for sale");
    await pp.connect(alice).listForSale(2, ethers.parseEther("0.5"));
    await expect(
      pp.connect(bob).buyParcel(2, { value: ethers.parseEther("0.4") })
    ).to.be.revertedWith("insufficient payment");
  });

  it("refunds over-payment on claim and on buy", async function () {
    const over = BASE + ethers.parseEther("0.5");
    const balBefore = await ethers.provider.getBalance(alice.address);
    const tx = await pp.connect(alice).claimParcel(3, 0, "", { value: over });
    const rcpt = await tx.wait();
    const gas = rcpt.gasUsed * rcpt.gasPrice;
    const balAfter = await ethers.provider.getBalance(alice.address);
    expect(balBefore - balAfter).to.equal(BASE + gas);
  });

  it("getParcels returns parallel arrays in correct order", async function () {
    await pp.connect(alice).claimParcel(0, 0x111111, "a", { value: BASE });
    await pp.connect(bob).claimParcel(1, 0x222222, "b", { value: BASE });
    await pp.connect(bob).listForSale(1, ethers.parseEther("2"));
    const [owners, colors, prices] = await pp.getParcels([0, 1, 2]);
    expect(owners).to.deep.equal([alice.address, bob.address, ethers.ZeroAddress]);
    expect(colors.map(Number)).to.deep.equal([0x111111, 0x222222, 0]);
    expect(prices).to.deep.equal([0n, ethers.parseEther("2"), 0n]);
  });

  it("getOwnedParcels tracks add/remove correctly across sale", async function () {
    await pp.connect(alice).claimParcel(11, 0, "", { value: BASE });
    await pp.connect(alice).claimParcel(22, 0, "", { value: BASE });
    await pp.connect(alice).listForSale(22, ethers.parseEther("0.1"));
    await pp.connect(bob).buyParcel(22, { value: ethers.parseEther("0.1") });
    const aliceOwned = (await pp.getOwnedParcels(alice.address)).map(Number);
    const bobOwned = (await pp.getOwnedParcels(bob.address)).map(Number);
    expect(aliceOwned).to.deep.equal([11]);
    expect(bobOwned).to.deep.equal([22]);
  });

  it("admin bounds enforced (setBasePrice, setPlatformFeeBps)", async function () {
    await expect(pp.connect(alice).setBasePrice(1)).to.be.revertedWithCustomError(pp, "OwnableUnauthorizedAccount");
    await expect(pp.setBasePrice(ethers.parseEther("2"))).to.be.revertedWith("exceeds max");
    await expect(pp.setPlatformFeeBps(1001)).to.be.revertedWith("exceeds max");
    await pp.setBasePrice(ethers.parseEther("0.01"));
    await pp.setPlatformFeeBps(500);
    expect(await pp.parcelBasePrice()).to.equal(ethers.parseEther("0.01"));
    expect(await pp.platformFeeBps()).to.equal(500);
  });

  it("pause blocks claim/update/list/buy", async function () {
    await pp.pause();
    await expect(pp.connect(alice).claimParcel(0, 0, "", { value: BASE }))
      .to.be.revertedWithCustomError(pp, "EnforcedPause");
    await pp.unpause();
    await pp.connect(alice).claimParcel(0, 0, "", { value: BASE });
    await pp.pause();
    await expect(pp.connect(alice).updateParcel(0, 1, "x"))
      .to.be.revertedWithCustomError(pp, "EnforcedPause");
    await expect(pp.connect(alice).listForSale(0, 1))
      .to.be.revertedWithCustomError(pp, "EnforcedPause");
  });

  it("withdrawFees pays accumulated fees to recipient", async function () {
    await pp.connect(alice).claimParcel(0, 0, "", { value: BASE });
    await pp.connect(bob).claimParcel(1, 0, "", { value: BASE });
    const before = await ethers.provider.getBalance(carol.address);
    await pp.withdrawFees(carol.address);
    const after = await ethers.provider.getBalance(carol.address);
    expect(after - before).to.equal(BASE * 2n);
    await expect(pp.withdrawFees(carol.address)).to.be.revertedWith("nothing to withdraw");
  });
});
