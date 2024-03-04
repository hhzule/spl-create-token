import { FC, useEffect, useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { WalletAdapterNetwork, WalletError } from "@solana/wallet-adapter-base";

import {
  clusterApiUrl,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
  LAMPORTS_PER_SOL
} from "@solana/web3.js";
import mpl from "@metaplex-foundation/js";
// Wallet
import {
  MINT_SIZE,
  createInitializeMintInstruction,
  getMinimumBalanceForRentExemptMint,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  createBurnCheckedInstruction,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getMint
} from "@solana/spl-token";
import { PROGRAM_ID, createCreateMetadataAccountV3Instruction, createCreateMetadataAccountInstruction } from "@metaplex-foundation/mpl-token-metadata";
import { notify } from "../../utils/notifications";
import axios from "axios";
// Components
import { RequestAirdrop } from "../../components/RequestAirdrop";
import pkg from '../../../package.json';

import { useRouter } from "next/router";
// Store

import useUserSOLBalanceStore from "../../stores/useUserSOLBalanceStore";
import { NetworkConfigurationProvider, useNetworkConfiguration } from "../../contexts/NetworkConfigurationProvider";
import { is } from "immer/dist/internal";
import { set } from "date-fns";
//constants

export const CreateView: FC = ({ }) => {

  const { connection: wconn } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { networkConfiguration, setNetworkConfiguration } = useNetworkConfiguration();
  const network = networkConfiguration as WalletAdapterNetwork;
  // const endpoint = () => clusterApiUrl(network)
  const wallet = useWallet();
  const [burnTrx,
    setBurnTrx] = useState("");
  const [supply,
    setSupply] = useState("");
  const [amount,
    setAmount] = useState("");
  const [connection,
    setConnection] = useState(null);
  const [loading,
    setLoading] = useState(false);
  const router = useRouter();
  //token create

  const [mintAddress,
    setMintAddress] = useState("");
  const [isLoadingImage,
    setIsLoadingImage] = useState(false);

  const [token,
    setToken] = useState({
      name: "",
      symbol: "",
      decimals: "",
      amount: "",
      description: "",
      image: "",
      fStkAuth: false,
      fMintAuth: false,
    });

  const [amountError, setAmountError] = useState(false);
  const [decimalsError, setDecimalsError] = useState(false);

  const handleFormfieldchange = (fieldName: any, e: any) => {

    if (fieldName == "amount") {
      if (e.target.value.length > 10) {
        setAmountError(true);
        // wait for 1 second and then clear the error
        setTimeout(() => {
          setAmountError(false);
        }, 1000);
        return;
      }
      else
        setAmountError(false);
    }
    if (fieldName == "decimals") {
      if (Number(e.target.value) > 9) {
        setDecimalsError(true);
        setTimeout(() => {
          setDecimalsError(false);
        }, 1000);
        return;
      }
      else
        setDecimalsError(false);
    }
    else if (fieldName == "fStkAuth" || fieldName == "fMintAuth") {
      setToken({
        ...token,
        [fieldName]: e.target.checked
      });
      return;
    }
    setToken({
      ...token,
      [fieldName]: e.target.value
    });
  };

  const createToken = useCallback(async (token: any) => {
    if (!connection) {
      notify({ type: "error", message: "Connect Wallet" });
      return;

    }
    if (!publicKey) {
      notify({ type: "error", message: "Connect Wallet" });
      return;
    }

    if (!token.name || !token.symbol || !token.amount || !token.description || !token.decimals || !token.image || token.supply) {
      notify({ type: "error", message: "Required field missing" });
      return;
    }

    if (!isSupplyValid(token)) {
      notify({ type: "error", message: "(Supply * (10 **decimals)) should be less than 1844674407709551615" });
      return;
    }


    setLoading(true);

    const lamports: any = await getMinimumBalanceForRentExemptMint(connection);

    const mintKeyPair = Keypair.generate();
    const tokenATA = await getAssociatedTokenAddress(mintKeyPair.publicKey, publicKey);

    try {
      const metadataUrl: any = await uploadMetadata(token);
      // const metadataUrl =
      // "https://gateway.pinata.cloud/ipfs/QmdxcSSGeCegUBuqRG4D3mY3UpbEpEuRvK8neZNqPDW
      // MXF"

      const createNewTokenTransaction = new Transaction().add(SystemProgram.createAccount({ fromPubkey: publicKey, newAccountPubkey: mintKeyPair.publicKey, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID, lamports: lamports }), createInitializeMintInstruction(mintKeyPair.publicKey, Number(token.decimals), publicKey, publicKey, TOKEN_PROGRAM_ID), createAssociatedTokenAccountInstruction(publicKey, tokenATA, publicKey, mintKeyPair.publicKey), createMintToInstruction(mintKeyPair.publicKey, tokenATA, publicKey, Number(token.amount) * Math.pow(10, Number(token.decimals))), createCreateMetadataAccountV3Instruction({
        metadata: PublicKey.findProgramAddressSync([
          Buffer.from("metadata"),
          PROGRAM_ID.toBuffer(),
          mintKeyPair
            .publicKey
            .toBuffer()
        ], PROGRAM_ID)[0],
        mint: mintKeyPair.publicKey,
        mintAuthority: publicKey,
        updateAuthority: publicKey,
        payer: publicKey
      }, {
        createMetadataAccountArgsV3: {
          data: {
            name: token.name,
            symbol: token.symbol,
            uri: metadataUrl,
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
            // collectionDetails: null,
          },
          isMutable: true,
          collectionDetails: null
        }
      }));

      const signature = await sendTransaction(createNewTokenTransaction, connection, { signers: [mintKeyPair] });

      setMintAddress(mintKeyPair.publicKey.toString());
      notify({ type: "success", message: "Token created successfully", txid: signature });
      setLoading(false);
    } catch (err) {
      setLoading(false);
      console.error(err);
      notify({ type: "error", message: "Token created failed" });
    }
  }, [publicKey, connection, sendTransaction]);

  const uploadMetadata = async (token: any) => {
    const { name, symbol, description, image } = token;
    if (!name || !symbol || !description || !image) {
      return notify({ type: "error", message: "dat1a missing" });
    }
    const data = JSON.stringify({ name: name, symbol: symbol, description: description, image: image });
    try {
      const response = await axios({
        method: "POST",
        url: "https://api.pinata.cloud/pinning/pinJSONToIPFS",
        data: data,
        headers: {
          pinata_api_key: "711fde015814d07cfe8d",
          pinata_secret_api_key: "d5df98d3fade58583596557673e48392a9bc77e71440f271306f05d610d6e702",
          "Content-Type": "application/json"
        }
      });
      const url = `https://gateway.pinata.cloud/ipfs/${response.data.IpfsHash}`;
      return url;
    } catch (error) {
      console.error(error);
      notify({ type: "error", message: "upload failed" });
    }
  };

  const handleImageChange = async (e: any) => {
    const file = e.target.files[0];
    if (!connection) {
      notify({ type: "error", message: "Connect Wallet" });
      return;

    }
    if (!publicKey) {
      notify({ type: "error", message: "Connect Wallet" });
      return;

    }
    if (file) {
      setIsLoadingImage(true);
      const imgUrl: any = await uploadImagePinata(file);
      setIsLoadingImage(false);
      setToken({
        ...token,
        image: imgUrl
      });
    }
  };

  const uploadImagePinata = async (file: any) => {
    if (file) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await axios({
          method: "post",
          url: "https://api.pinata.cloud/pinning/pinFileToIPFS",
          data: formData,
          headers: {
            pinata_api_key: "bc9c3b506dd4ee80d207",
            pinata_secret_api_key: "eadcd94ba1a7a871dff92d344c92149c832ae06826496b48bbbda00a2b4453ec",
            "Content-Type": "multipart/form-data"
          }
        });
        const ImgHash = `https://gateway.pinata.cloud/ipfs/${response.data.IpfsHash}`;
        return ImgHash;
      } catch (error) {
        console.error(error);
        notify({ type: "error", message: "upload image failed" });
      }
    }
  };

  useEffect(() => {
    if (network == "devnet") {
      setNetworkConfiguration("mainnet-beta")
    }
    // if (network == "mainnet-beta") {
    // setNetworkConfiguration(e.target.value)
    if (wallet.publicKey) {
      const connection = new Connection("https://mainnet.helius-rpc.com/?api-key=78c69964-e500-4354-8f43-eec127b47bd7");
      setConnection(connection);
    }

    // } else {
    //   if (wallet.publicKey) {
    //     console.log(wallet.publicKey.toBase58());
    //     const connection = wconn;
    //     setConnection(connection);
    //   }
    // }

  }, [wallet.publicKey, network]);

  useEffect(() => {
    if (connection) {
      getUserSOLBalance(wallet.publicKey, connection);
    }
  }, [connection]);

  const balance = useUserSOLBalanceStore((s) => s.balance);

  const { getUserSOLBalance } = useUserSOLBalanceStore();

  const onClick = () => {
    router.push("/");
  };

  const isSupplyValid = (inputToken) => {
    const amount = BigInt(inputToken.amount);
    const decimals = BigInt(inputToken.decimals);
    const maxSupply = BigInt("1844674407709551615");
    const calculatedSupply = amount * BigInt(10 ** Number(decimals));
    return calculatedSupply <= maxSupply;
  };

  return (
    <div>
      <div className="card-wallet-balance mx-auto p-4">
        {wallet && (
          <div className="flex flex-row justify-center">
            <div className="text-2xl text-slate-300">
              Wallet Balance: {(balance || 0).toLocaleString()} SOL
            </div>
          </div>
        )}
      </div>

      <div className="card mx-auto p-4">
        <div className="flex flex-col justify-center items-center space-y-4">

          <div className="flex flex-col space-y-4">
            <div>
              <label className="label" htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                value={token.name}
                onChange={(e) => handleFormfieldchange("name", e)}
                className="input-style"
              />
            </div>

            <div>
              <label className="label" htmlFor="symbol">Symbol</label>
              <input
                id="symbol"
                type="text"
                value={token.symbol}
                onChange={(e) => handleFormfieldchange("symbol", e)}
                className="input-style"
              />
            </div>

            <div>
              <label className="label" htmlFor="description">Description</label>
              <textarea
                id="description"
                value={token.description}
                onChange={(e) => handleFormfieldchange("description", e)}
                className="input-style"
              ></textarea>
            </div>

            <div>
              <label className="label" htmlFor="amount">Supply</label>
              <input
                id="amount"
                type="number"
                value={token.amount}
                onChange={(e) => handleFormfieldchange("amount", e)}
                className="input-style"
              />
              {amountError && <div className="text-yellow-500">Supply should be less than 9999999999</div>}
            </div>

            <div>
              <label className="label" htmlFor="decimals">Decimals</label>
              <input
                id="decimals"
                type="number"
                value={token.decimals}
                onChange={(e) => handleFormfieldchange("decimals", e)}
                className="input-style"
              />
              {decimalsError && <div className="text-yellow-500">Decimals should be less than 10</div>}
            </div>

            {isLoadingImage ? (
              <div>Loading Image..</div>
            ) : (
              <div>
                {token.image && (
                  <div>
                    <label className="label-purple" htmlFor="image">Selected Image</label>
                    <br />
                    <img src={token.image} width={100} height={100} />
                    <br />
                  </div>
                )}
                <label className="label" htmlFor="image">Select Image</label>
                <input
                  type="file"
                  name="file"
                  onChange={(e) => handleImageChange(e)}
                  className="input-style"
                />
              </div>
            )}

            <div className="flex flex-col space-y-2">
              <div className="flex flex-row space-x-2">
                <input type="checkbox" id="fStkSuth" name="fStkSuth" onChange={(e) => handleFormfieldchange("fStkAuth", e)} />
                <label className="label">Freeze Staking Authority</label>
              </div>

              <div className="flex flex-row space-x-2">
                <input type="checkbox" id="fStkMint" name="fStkMint" onChange={(e) => handleFormfieldchange("fStkAuth", e)} />
                <label className="label">Freeze Minting Authority</label>
              </div>
            </div>
            <button
              disabled={isLoadingImage || loading}
              className="button-style"
              onClick={() => createToken(token)}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </div>



  );
};
