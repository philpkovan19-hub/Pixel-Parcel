const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(signer.address);
  const net = await hre.ethers.provider.getNetwork();

  console.log("Deploying PixelParcel");
  console.log("Network chainId:", net.chainId.toString());
  console.log("Deployer:       ", signer.address);
  console.log("Balance:        ", hre.ethers.formatEther(balance), "BOT");

  const PP = await hre.ethers.getContractFactory("PixelParcel");
  const pp = await PP.deploy();
  await pp.waitForDeployment();

  const addr = await pp.getAddress();
  console.log("PixelParcel deployed at:", addr);
  console.log("");
  console.log("Update CONTRACT_ADDRESS in frontend/index.html");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
