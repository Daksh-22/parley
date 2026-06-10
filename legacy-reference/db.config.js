import mongoose from "mongoose";
// Database url added in .env
const baseUrl = process.env.MONGODB || "127.0.0.1:27017" || "0.0.0.0:27017";
// Connect to the database
export const connectToDatabase = async () => {
  try {
    await mongoose.connect(`mongodb://${baseUrl}/chatterup`, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("MongoDB connected using mongoose");
  } catch (err) {
    console.log(err);
  }
};
