import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const filename = ".env.server.local";
if (existsSync(filename)) throw new Error("既存の秘密設定は上書きしません。");
const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const publicValue = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, "base64url"),
  Buffer.from(pub.y, "base64url"),
]).toString("base64url");
writeFileSync(
  filename,
  `VAPID_PUBLIC_KEY=${publicValue}\nVAPID_PRIVATE_KEY=${priv.d}\nREMINDER_WORKER_SECRET=${randomBytes(32).toString("hex")}\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(
  "秘密設定をGit対象外の.env.server.localに保存しました。秘密の値は表示していません。",
);
console.log(`公開用VAPIDキー: ${publicValue}`);
