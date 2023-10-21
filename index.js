const express = require('express');
const app = express();
const multer = require('multer');
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser'); 
app.use(express.static('uploads'));
const mongodbURL='mongodb+srv://harshithabali45:AmmaNanna%40222@project.n5pr1td.mongodb.net/Project'
mongoose.connect(mongodbURL, {
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Connected to MongoDB');
}).catch((error) => {
  console.log('Error connecting to MongoDB:', error);
}); 
const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  avatar: String,
  messages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],
  tasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: [] }]
}, { collection: 'users' });

const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: String,
  time: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

const taskSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['assigned', 'accepted', 'completed'],
    default: 'assigned'
  }
}, { timestamps: true });
const Task = mongoose.model('Task', taskSchema); 
app.set('view engine', 'ejs'); 
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'harshitha',
  resave: false,
  saveUninitialized: true,
})); 
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage }); 
app.get('/users', async (req, res) => {
  try {
    const currentUser = req.session.username;
    const users = await User.find({ username: { $ne: currentUser } }, 'username avatar');
    res.json({ users });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
}); 
app.get('/register', (req, res) => {
  res.render('register');
});

async function getUsers(req) {
  try {
    const currentUser = req.session.username;
    const users = await User.find({ username: { $ne: currentUser } }, 'username avatar');
    return users;
  } catch (error) {
    console.log(error);
    throw new Error('Failed to fetch users');
  }
}
app.post('/register', upload.single('avatar'), async (req, res) => {
  const { username, email, password } = req.body;
  const avatar = req.file ? req.file.filename : '';

  const newUser = new User({ username, email, password, avatar });
  await newUser.save(); 
  io.emit('user-registered', { username, avatar });

  res.redirect('/login');
}); 
app.get('/chat/:username', async (req, res) => {
  try {
    const selectedUser = req.params.username;
    const currentUser = req.session.username;

    const selectedUserDoc = await User.findOne({ username: selectedUser });
    const currentUserDoc = await User.findOne({ username: currentUser });

    if (!selectedUserDoc || !currentUserDoc) {
      return res.status(404).json({ error: 'User not found' });
    }

    const messages = await Message.find({
      $or: [
        { sender: selectedUserDoc._id, receiver: currentUserDoc._id },
        { sender: currentUserDoc._id, receiver: selectedUserDoc._id }
      ]
    }).populate('sender receiver').sort({ time: 1 });

    res.json({ messages });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Failed to fetch chat messages' });
  }
}); 
app.get('/', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email, password });

  if (user) {
    req.session.username = user.username;
    res.render('home', { username: user.username });
  } else {
    res.send('Invalid email or password');
  }
});

app.get('/chat-long-polling/:username', async (req, res) => {
  try {
    const selectedUser = req.params.username;
    const currentUser = req.session.username;

    const selectedUserDoc = await User.findOne({ username: selectedUser });
    const currentUserDoc = await User.findOne({ username: currentUser });

    if (!selectedUserDoc || !currentUserDoc) {
      return res.status(404).json({ error: 'User not found' });
    }

    const messages = await Message.find({
      $or: [
        { sender: selectedUserDoc._id, receiver: currentUserDoc._id },
        { sender: currentUserDoc._id, receiver: selectedUserDoc._id }
      ]
    }).populate('sender receiver').sort({ time: 1 });

    res.json({ messages });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Failed to fetch chat messages' });
  }
}); 
app.post('/assign-task', async (req, res) => {
  const { sender, receiver, content, dueDate } = req.body;

  try {
    if (!sender || !receiver || !content || !dueDate) {
      return res.status(400).send('Missing required fields');
    }
    const senderUser = await User.findOne({ username: sender });
    const receiverUser = await User.findOne({ username: receiver });

    if (!senderUser || !receiverUser) {
      return res.status(404).send('Sender or receiver not found');
    }
    const task = new Task({
      sender: senderUser._id,
      receiver: receiverUser._id,
      content: content,
      dueDate: dueDate
    });
    await task.save();
    io.emit('task-assigned', task);
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});
app.post('/accept-task', async (req, res) => {
  const taskId = req.body.taskId;

  try {
    const task = await Task.findByIdAndUpdate(taskId, { status: 'accepted' });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    await task.save();
    io.emit('task-accepted', task);

    res.status(200).json({ task });  
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});
app.post('/reject-task', async (req, res) => {
  const taskId = req.body.taskId;

  try {
    const task = await Task.findByIdAndUpdate(taskId, { status: 'rejected' });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await task.save();
    io.emit('task-rejected', task);

    res.status(200).json({ task});  
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});
app.post('/send-message', async (req, res) => {
  try {
    const { sender, receiver, content } = req.body;

    const senderUser = await User.findOne({ username: sender });
    const receiverUser = await User.findOne({ username: receiver });

    if (!senderUser || !receiverUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newMessage = new Message({
      sender: senderUser._id,
      receiver: receiverUser._id,
      content,
      time: new Date()
    });

    await newMessage.save();

    senderUser.messages.push(newMessage);
    receiverUser.messages.push(newMessage);
    await senderUser.save();
    await receiverUser.save();
    io.to(receiverUser.username).emit('new-message', { message: newMessage });
    res.json({ message: newMessage });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});
io.on('connection', (socket) => {
  socket.on('join-room', (username) => {
    socket.join(username);
  });

  socket.on('task-assigned', (task) => {
    io.emit('new-task', task);
  });

  socket.on('task-accepted', (taskId) => {
    io.emit('task-accepted', taskId);
  });

  socket.on('task-rejected', (taskId) => {
    io.emit('task-rejected', taskId);
  });
}); 
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('login');
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.get('/task', async (req, res) => {
  try {
    const username = req.session.username;
    const users = await getUsers(req); 
    const assignedTasks = await Task.find().populate('sender receiver');
    console.log('username:', username);
    console.log('users:', users);
    console.log('assignedTasks:', assignedTasks);
    res.render('task', { username: username, users: users, assignedTasks: assignedTasks }); // Pass currentUser and assignedTasks to the template
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});
app.get('/chat', (req, res) => {
  const username = req.session.username;
  res.render('chat', { username });
});

http.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});
