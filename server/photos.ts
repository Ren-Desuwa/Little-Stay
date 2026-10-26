import { head, put, BlobNotFoundError } from '@vercel/blob';

export interface PhotoStore {
  install(name: string, bytes: Buffer): Promise<void>;
  exists(name: string): Promise<boolean>;
  url(name: string): Promise<string | null>;
}

export function blobPhotos(token: string): PhotoStore {
  const url = async (name: string) => {
    try {
      return (await head(`uploads/${name}`, { token })).url;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  };
  return {
    async install(name, bytes) {
      await put(`uploads/${name}`, bytes, {
        token,
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: name.endsWith('.jpg')
          ? 'image/jpeg'
          : name.endsWith('.png')
            ? 'image/png'
            : 'image/webp',
      });
    },
    url,
    async exists(name) {
      return (await url(name)) !== null;
    },
  };
}
