import { BoxCcgAuth, BoxClient, CcgConfig } from "box-node-sdk";
import { readByteStream } from "box-node-sdk/internal";
import { Resource } from "sst";

export interface BoxFile {
  id: string;
  name: string;
  size: number;
  content: Buffer;
}

export async function createBoxClient(): Promise<BoxClient> {
  const config = new CcgConfig({
    clientId: Resource.BOX_CLIENT_ID.value,
    clientSecret: Resource.BOX_CLIENT_SECRET.value,
    enterpriseId: Resource.BOX_ENTERPRISE_ID.value,
  });
  const auth = new BoxCcgAuth({ config });
  return new BoxClient({ auth });
}

export async function pullBoxFile(client: BoxClient, fileId: string): Promise<BoxFile> {
  const file = await client.files.getFileById(fileId);
  const stream = await client.downloads.downloadFile(fileId);
  const content = stream ? await readByteStream(stream) : Buffer.alloc(0);

  return {
    id: file.id,
    name: file.name ?? fileId,
    size: file.size ?? content.byteLength,
    content,
  };
}
