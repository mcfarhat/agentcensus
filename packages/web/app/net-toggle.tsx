export function NetToggle({ net, path, extra = "" }: { net: string; path: string; extra?: string }) {
  return (
    <div className="netpill" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
      network:
      <a className={net === "testnet" ? "on" : ""} href={`${path}?net=testnet${extra}`}>
        testnet
      </a>
      <a className={net === "mainnet" ? "on" : ""} href={`${path}?net=mainnet${extra}`}>
        mainnet
      </a>
    </div>
  );
}
