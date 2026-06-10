// Import required modules
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import Chat from './chatter.schema.js';
import { ObjectId } from 'mongodb';

// Express app and configure middleware
export const app = express();
app.use(cors());

// HTTP server using Express app
export const server = http.createServer(app);

// Initialize Socket.IO server with custom configurations
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ["GET", "POST"]
    }
});

// Array to store online users
let onlineUser = [];

// Event handling for Socket.IO connections
io.on("connection", (socket) => {
    console.log("Connection Made ");

    // Event: User joins
    socket.on('join', async (name) => {
        const oldMessage = await Chat.find();
        onlineUser.push({ id: socket.id, name });
        io.emit("onlineUser", onlineUser);
        io.emit('joined', oldMessage);
    });

    // Event: User typing
    socket.on('typing', () => {
        io.emit('typing', socket.id);
    });

    // Event: User sends a message
    socket.on("sendMessage", async (newMessage) => {
        if (!newMessage.message || !newMessage.name) {
            return;
        }
        const newUser = new Chat({
            name: newMessage.name,
            message: newMessage.message,
            time: new Date(),
        });
        io.emit("newMessage", await newUser.save());
    });

    // Event: User disconnects
    socket.on("disconnect", () => {
        const indexToRemove = onlineUser.findIndex(user => user.id == socket.id);
        onlineUser.splice(indexToRemove, 1);
        io.emit('onlineUser', onlineUser);
        console.log("Connection disconnected.");
    });
});
