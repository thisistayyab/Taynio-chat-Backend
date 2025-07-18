import mongoose from "mongoose";

const mongoDB_connection = async () =>{
    try {
        const connectionInstance = await mongoose.connect(`${process.env.MONGO_URI }/Taynio`);
        console.log("mongoDB connected successfully")
    } catch (error) {
        console.log("Connection failed", error);
        process.exit();
    }
}

export { mongoDB_connection}