import 'dotenv/config';
import ImageKit from 'imagekit';

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

const uploadOnImageKit = async (fileBuffer, fileName) => {
  try {
    if (!fileBuffer) return null;

    const base64 = fileBuffer.toString('base64');

    const result = await imagekit.upload({
      file: base64,
      fileName: fileName || 'upload_file',
    });

    return result; // contains result.url, result.fileId, etc.
  } catch (error) {
    console.error("ImageKit Upload Error:", error?.message || error);
    return null;
  }
};

export { uploadOnImageKit };
