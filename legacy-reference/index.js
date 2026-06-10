// Import all importent  modules and files
import dotenv from 'dotenv';
dotenv.config();
import { connectToDatabase } from "./db.config.js";
import {server} from './server.js'
connectToDatabase
server.listen(5100, () => {
    console.log('Server is running on port 5100');
    // call the connect to database here
    connectToDatabase();
});

