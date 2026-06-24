import dns from "node:dns";
import mongoose from "mongoose";

dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
dns.setDefaultResultOrder("ipv4first");

const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB_NAME || "lipovoy";

export async function connectDatabase(retries = 3) {
  if (!uri) {
    console.error("MONGO_URI is required");
    return false;
  }

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        dbName,
        serverSelectionTimeoutMS: 20000,
        connectTimeoutMS: 20000,
        family: 4,
      });
      console.log(`MongoDB connected (${dbName})`);
      return true;
    } catch (error) {
      console.error(`MongoDB attempt ${attempt}/${retries} failed:`, error.message);
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  return false;
}
