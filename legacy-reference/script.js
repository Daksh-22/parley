const socket = io.connect("https://chatterup-bharat.onrender.com/socket.io/socket.io.js");
// DOM elements
const myPrompt = document.getElementById("my-prompt");
const userName = document.getElementById("name");
const message = document.getElementById("text-message");
const sendMessage = document.getElementById("message-form");

// Display prompt on page load
document.addEventListener("DOMContentLoaded", () => {
  myPrompt.style.display = "flex";
});

// Event: User submits prompt form to join
myPrompt.addEventListener("submit", (event) => {
  event.preventDefault();
  const welcome = document.getElementById("welcome");
  welcome.innerText = "Welcome, " + userName.value;
  myPrompt.style.display = "none";
  socket.emit("join", userName.value);
});

// Event: Update online users and old messages
socket.on("onlineUser", (users) => {
  const onlineUser = document.getElementById("online-user");
  onlineUser.innerHTML = "";
  const count = document.getElementById("count");
  count.innerText = "Online(" + users.length + ")";
  users.forEach((user) => {
    const newUser = document.createElement("div");
    newUser.innerHTML = `   <div class="user">
                            <img src="public/1.jpg" alt="R">
                            <p>${user.name}</p>
                            <span class="online-dot"></span>
                            <p id="${user.id}" class="typing"><p>
        
                    </div>`;
    onlineUser.appendChild(newUser);
  });
});

// Event: Display old messages  when loaded from server
socket.on("joined", (oldMessage) => {
  const messageList = document.getElementById("message-list");
  const map = new Map();
  let i = 1;
  oldMessage.forEach((message) => {
    const oldmsg = document.createElement("div");
    const timestamp = new Date(message.time);
    if (!map.get(message.name)) {
      if (i > 4) {
        i = 1;
      }
      map.set(message.name, i++);
    }
    oldmsg.innerHTML = `
        <div class="message-block" >
            <img src="public/${map.get(message.name)}.jpg" alt="pic">
            <div class="message-content">
                <p class="name" style="margin-bottom: 15px;">${message.name}</p>
                <p class="message" >${message.message}</p>
                <p class="timestamp">${timestamp.getHours()}:${timestamp.getMinutes()}</p>
            </div>
        </div>`;
    messageList.appendChild(oldmsg);
  });
  scrollToBottom();
});

// Event: Typing indicator
message.addEventListener("input", () => {
  socket.emit("typing", userName.value);
});
socket.on("typing", (userId) => {
  if (userId) {
    document.getElementById(userId).innerText = "typing..";
  }
  setTimeout(() => {
    document.getElementById(userId).innerText = "";
  }, 500);
});

// Event: Send message to server
sendMessage.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = { name: userName.value, message: message.value };
  socket.emit("sendMessage", data);
});

// Event: Receive and display new message
socket.on("newMessage", (newMessage) => {
  const messageList = document.getElementById("message-list");
  const msg = document.createElement("div");
  const timestamp = new Date(newMessage.time);
  if (newMessage.name == userName.value) {
    msg.innerHTML = `
        <div class="message-block-user">
            <img src="public/1.jpg" alt="pic">
            <div class="message-content" style="background-color: #6b63e1; color: white;">
                <p class="name" style="color:white; font-weight: bold; margin-bottom: 15px;">${
                  newMessage.name
                }</p>
                <p class="message">${newMessage.message}</p>
                <p class="timestamp">${timestamp.getHours()}:${timestamp.getMinutes()}</p>
            </div>
        </div>`;
    messageList.appendChild(msg);
  } else {
    msg.innerHTML = `
        <div class="message-block">
            <img src="public/2.jpg" alt="pic">
            <div class="message-content">
                <p class="name">${newMessage.name}</p>
                <p class="message">${newMessage.message}</p>
                <p class="timestamp">Sent 12:11:1</p>
            </div>
        </div>`;
    messageList.appendChild(msg);
  }
  scrollToBottom();
});

// Scroll to bottom of message list
function scrollToBottom() {
  const messageList = document.getElementById("message-list");
  // Scroll the message container to the bottom
  messageList.scrollTop = messageList.scrollHeight;
}
