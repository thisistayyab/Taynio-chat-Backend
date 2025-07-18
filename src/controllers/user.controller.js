import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.model.js";
import jwt from 'jsonwebtoken'
import { uploadOnImageKit } from "../utils/imagekit.js";
import { sendMail } from "../utils/sendMail.js";
import crypto from 'crypto';
import { redisClient } from '../utils/redisClient.js';
import { FriendRequest } from '../models/friendRequest.model.js';
import { getIO } from '../socket.js';
import { Message } from '../models/message.model.js';

const generateAcessAndRefreshToken = async (userid)=>{
    try {
        const user = await User.findById(userid)
        if (!user) {
            throw new ApiError(404, "User not found for token generation");
        }
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()
        user.refreshToken = refreshToken
        await user.save({validateBeforeSave:false})
        return {accessToken,refreshToken}
    } catch (error) {
        throw new ApiError(500, "Something went wrong at the end")
    }
}

const registerUser = asyncHandler(async(req,res)=>{
    const{ username, password, email, fullname} = req.body
    if([username,password,email,fullname].some((field)=>field?.trim()==="")){
        throw new ApiError(400,"All fields are required");
    }
    const existedUser = await User.findOne({
        $or: [{username}, {email}]
    })
    if(existedUser){
        throw new ApiError(409, "User Already existed")
    }
    // Check if a pending signup exists in Redis
    const redisKey = `signup:${email}`;
    const pending = await redisClient.get(redisKey);
    if (pending) {
        throw new ApiError(429, 'A verification code was already sent. Please check your email or wait before retrying.');
    }
    // Generate code and store signup data in Redis
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const signupData = { username, password, email, fullname, code };
    await redisClient.set(redisKey, JSON.stringify(signupData), { EX: 15 * 60 }); // 15 min expiry
    // Send code by email
    try {
        await sendMail({
            to: email,
            subject: 'Verify Your Email - Taylance CRM',
            html: `
    <div style="font-family: Arial, sans-serif; background-color: #f4f6f9; padding: 20px;">
      <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <h2 style="color: #2a2a2a;">Email Verification - Taylance CRM</h2>
        <p style="font-size: 15px; color: #444;">Use the verification code below to verify your email address:</p>
        <div style="margin: 20px 0; font-size: 28px; font-weight: bold; color: #007bff;">${code}</div>
        <p style="font-size: 14px; color: #666;">This code will expire in 10 minutes. Please do not share it with anyone.</p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 13px; color: #999;">
          Need help? Email <a href="mailto:support@taylance.com" style="color: #007bff;">taylance@gmail.com</a>
        </p>
      </div>
    </div>
  `
        });
    } catch (err) {
        await redisClient.del(redisKey);
        throw new ApiError(500, 'Failed to send verification email. Please try again.');
    }
    return res.status(201).json(
        new ApiResponse(200, { email },"Verification code sent. Please check your inbox.")
    )
})

const verifyCode = asyncHandler(async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) throw new ApiError(400, 'Email and code are required');
    const redisKey = `signup:${email}`;
    const pending = await redisClient.get(redisKey);
    if (!pending) throw new ApiError(400, 'No pending verification found. Please sign up again.');
    const signupData = JSON.parse(pending);
    if (signupData.code !== code) {
        throw new ApiError(400, 'Invalid or expired verification code');
    }
    // Check again for existing user (race condition safety)
    const existedUser = await User.findOne({
        $or: [{username: signupData.username}, {email: signupData.email}]
    })
    if(existedUser){
        await redisClient.del(redisKey);
        throw new ApiError(409, "User Already existed")
    }
    // Create user in DB
    const user = await User.create({
        fullname: signupData.fullname,
        email: signupData.email,
        password: signupData.password,
        username: signupData.username.toLowerCase(),
        isVerified: true
    });
    await redisClient.del(redisKey);
    return res.status(200).json(new ApiResponse(200, {}, 'Email verified successfully. You can now log in.'));
});

const loginUser = asyncHandler(async(req,res)=>{
    const {username, email, password} = req.body
    if(!username&&!email)throw new ApiError(400,"Email or username required");
    const user = await User.findOne({
        $or: [{username}, {email}]
    })
    if(!user){
        throw new ApiError(400, "User not found")
    }
    if (!user.isVerified) {
        throw new ApiError(403, 'Please verify your email before logging in.');
    }
    const isPasswordValid = await user.isPasswordCorrect(password)
    if(!isPasswordValid){
        throw new ApiError(401, "Invalid Credentials")
    }
    
    const {accessToken, refreshToken} = await generateAcessAndRefreshToken(user._id)
    
    const logedInUser = await User.findById(user._id).select("-password -refreshToken")
    const options = {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
    return res.status(200).cookie("accessToken",accessToken,options).cookie("refreshToken",refreshToken,options).json(
        new ApiResponse(
            200,
            {
                user:logedInUser,accessToken,refreshToken
            },
            "user loggedIn successfully"
        )
    )
})

const logoutUser = asyncHandler(async(req,res)=>{
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set:{
                refreshToken:undefined
            }
        },
        {
            new:true
        }
    )
    const options = {
        httpOnly: true,
        secure: true,
        sameSite: 'none'
    }
    return res.status(200).clearCookie("accessToken",options).clearCookie("refreshToken",options).json(
        new ApiResponse(
            200,
            {},
            "User loggedout successfully"
        )
    )
})

const refreshAccessToken = asyncHandler(async(req,res)=>{
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken
    if(!incomingRefreshToken){
        throw new ApiError(401,"Unauthorized Request")
    }
    const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
    const user = await User.findById(decodedToken?._id)
    if(!user){
        throw new ApiError(401,"Invalid Refresh Token")
    }
    if(incomingRefreshToken !== user?.refreshToken){
        throw new ApiError(401, "Refresh Token is expired")
    }
    const {accessToken , newrefreshToken} = await generateAcessAndRefreshToken(user._id)
    const options = {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
    return res.status(200).cookie("accessToken", accessToken, options).cookie("refreshToken", newrefreshToken, options).json(
        new ApiResponse(
            200,
            {
                accessToken, refreshToken: newrefreshToken
            },
            "New Token Created Successfully"
        )
    )
})

const changeCurrentPassword = asyncHandler(async(req,res)=>{
    const {oldPassword, newPassword} = req.body
    const user = await User.findById(req.user._id)
    const checkPass = await user.isPasswordCorrect(oldPassword)
    if(!checkPass){
        throw new ApiError(400,"Password doesn't match")
    }
    user.password = newPassword
    await user.save({validateBeforeSave:false})
    return res.status(200).json(
        new ApiResponse(200,{}, "Password Changed successfully")
    )
})

const getCurrentUser = asyncHandler(async(req,res)=>{
    return res.status(200).json(new ApiResponse(200, req.user, "Current user fetched Successfully"))
})

const updateAccount = asyncHandler(async(req,res)=>{
    const {fullname, email, phone, address} = req.body;
    let profilepicUrl = undefined;
    if (req.file) {
        const result = await uploadOnImageKit(req.file.buffer);
        profilepicUrl = result?.url;
    }
    const updateFields = {};
    if(fullname) updateFields.fullname = fullname;
    if(email) updateFields.email = email;
    if(phone) updateFields.phone = phone;
    if(address) updateFields.address = address;
    if(profilepicUrl) updateFields.profilepic = profilepicUrl;
    if(Object.keys(updateFields).length === 0){
        throw new ApiError(400, "No fields to update");
    }
    const user = await User.findByIdAndUpdate(
        req.user?._id,
        { $set: updateFields },
        { new:true }
    ).select("-password");
    return res.status(200).json(new ApiResponse(200, user, "Profile updated successfully"));
})

const getAllUsers = asyncHandler(async (req, res) => {
    const users = await User.find({}, '-password -refreshToken');
    return res.status(200).json(new ApiResponse(200, users, 'Users fetched successfully'));
});

const resendCode = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) throw new ApiError(400, 'Email is required');
    const redisKey = `signup:${email}`;
    const pending = await redisClient.get(redisKey);
    if (!pending) throw new ApiError(400, 'No pending verification found. Please sign up again.');
    const signupData = JSON.parse(pending);
    // Generate new code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    signupData.code = code;
    await redisClient.set(redisKey, JSON.stringify(signupData), { EX: 15 * 60 }); // reset expiry
    try {
        await sendMail({
            to: email,
            subject: 'Your new verification code',
            html: `<p>Your new verification code is: <b>${code}</b></p>`
        });
    } catch (err) {
        throw new ApiError(500, 'Failed to resend verification email. Please try again.');
    }
    return res.status(200).json(new ApiResponse(200, { email }, 'A new verification code has been sent.'));
});

const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) throw new ApiError(400, 'Email is required');
    const user = await User.findOne({ email });
    if (!user) {
        throw new ApiError(404, 'No account found with that email.');
    }
    const redisKey = `reset:${email}`;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await redisClient.set(redisKey, code, { EX: 10 * 60 }); // 10 min expiry
    try {
        await sendMail({
            to: email,
            subject: 'Reset Your Password - Taylance CRM',
            html: `
    <div style="font-family: Arial, sans-serif; background-color: #f4f6f9; padding: 20px;">
      <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <h2 style="color: #2a2a2a;">Password Reset - Taylance CRM</h2>
        <p style="font-size: 15px; color: #444;">Use the code below to reset your password:</p>
        <div style="margin: 20px 0; font-size: 28px; font-weight: bold; color: #007bff;">${code}</div>
        <p style="font-size: 14px; color: #666;">This code will expire in 10 minutes. If you did not request this, you can ignore this email.</p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 13px; color: #999;">
          Need help? Email <a href="mailto:support@taylance.com" style="color: #007bff;">taylance@gmail.com</a>
        </p>
      </div>
    </div>
    `
        });
    } catch (err) {
        // Do not reveal error to user
    }
    return res.status(200).json(new ApiResponse(200, {}, 'A reset code has been sent to your email.'));
});

const resetPassword = asyncHandler(async (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) throw new ApiError(400, 'Email, code, and new password are required');
    const redisKey = `reset:${email}`;
    const storedCode = await redisClient.get(redisKey);
    if (!storedCode || storedCode !== code) {
        throw new ApiError(400, 'Invalid or expired reset code');
    }
    const user = await User.findOne({ email });
    if (!user) throw new ApiError(400, 'User not found');
    user.password = newPassword;
    await user.save({ validateBeforeSave: false });
    await redisClient.del(redisKey);
    return res.status(200).json(new ApiResponse(200, {}, 'Password has been reset. You can now log in.'));
});

// Add a friend
const addFriend = asyncHandler(async (req, res) => {
    const { friendId } = req.body;
    if (!friendId) throw new ApiError(400, 'Friend ID is required');
    if (friendId === req.user._id.toString()) throw new ApiError(400, 'Cannot add yourself as a friend');
    const friend = await User.findById(friendId);
    if (!friend) throw new ApiError(404, 'User not found');
    const user = await User.findById(req.user._id);
    if (user.friends.includes(friendId)) throw new ApiError(400, 'Already friends');
    user.friends.push(friendId);
    await user.save();
    return res.status(200).json(new ApiResponse(200, user, 'Friend added successfully'));
});

// Remove a friend
const removeFriend = asyncHandler(async (req, res) => {
    const { friendId } = req.body;
    if (!friendId) throw new ApiError(400, 'Friend ID is required');
    const user = await User.findById(req.user._id);
    user.friends = user.friends.filter(id => id.toString() !== friendId);
    await user.save();
    return res.status(200).json(new ApiResponse(200, user, 'Friend removed successfully'));
});

// Get all friends
const getFriends = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).populate('friends', '-password -refreshToken');
    return res.status(200).json(new ApiResponse(200, user.friends, 'Friends fetched successfully'));
});

// Search users by username or email
const searchUsers = asyncHandler(async (req, res) => {
    const { q } = req.query;
    if (!q || q.trim() === '') throw new ApiError(400, 'Search query is required');
    const regex = new RegExp(q, 'i');
    const users = await User.find({
        $and: [
            { $or: [ { username: regex }, { email: regex } ] },
            { _id: { $ne: req.user._id } }
        ]
    }).select('_id username fullname email profilepic');
    return res.status(200).json(new ApiResponse(200, users, 'Users found'));
});

// Send friend request
const sendFriendRequest = asyncHandler(async (req, res) => {
  const { to } = req.body;
  if (!to) throw new ApiError(400, 'Recipient user ID required');
  if (to === req.user._id.toString()) throw new ApiError(400, 'Cannot send request to yourself');
  const existing = await FriendRequest.findOne({ from: req.user._id, to, status: 'pending' });
  if (existing) throw new ApiError(400, 'Request already sent');
  const request = await FriendRequest.create({ from: req.user._id, to });
  // Emit notification to recipient
  getIO().to(to).emit('friendRequest', { from: req.user._id });
  return res.status(200).json(new ApiResponse(200, request, 'Friend request sent'));
});
// Get incoming friend requests
const getFriendRequests = asyncHandler(async (req, res) => {
  const requests = await FriendRequest.find({ to: req.user._id, status: 'pending' }).populate('from', 'username fullname email profilepic');
  return res.status(200).json(new ApiResponse(200, requests, 'Friend requests fetched'));
});
// Accept friend request
const acceptFriendRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.body;
  const request = await FriendRequest.findById(requestId);
  if (!request || request.to.toString() !== req.user._id.toString()) throw new ApiError(404, 'Request not found');
  if (request.status !== 'pending') throw new ApiError(400, 'Request already handled');
  request.status = 'accepted';
  await request.save();
  // Add each other as friends
  const user = await User.findById(req.user._id);
  const friend = await User.findById(request.from);
  if (!user.friends.includes(friend._id)) user.friends.push(friend._id);
  if (!friend.friends.includes(user._id)) friend.friends.push(user._id);
  await user.save();
  await friend.save();
  // Emit notification to sender
  getIO().to(request.from.toString()).emit('friendRequestAccepted', { by: req.user._id });
  return res.status(200).json(new ApiResponse(200, {}, 'Friend request accepted'));
});
// Reject friend request
const rejectFriendRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.body;
  const request = await FriendRequest.findById(requestId);
  if (!request || request.to.toString() !== req.user._id.toString()) throw new ApiError(404, 'Request not found');
  if (request.status !== 'pending') throw new ApiError(400, 'Request already handled');
  request.status = 'rejected';
  await request.save();
  return res.status(200).json(new ApiResponse(200, {}, 'Friend request rejected'));
});

// Send message
const sendMessage = asyncHandler(async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) throw new ApiError(400, 'Recipient and text required');
  const msg = await Message.create({ from: req.user._id, to, text });
  // Increment unread count for recipient
  await User.findByIdAndUpdate(to, { $inc: { [`unreadCounts.${req.user._id}`]: 1 } });
  // Emit real-time message to recipient
  getIO().to(to).emit('message', { ...msg.toObject(), from: req.user._id, to });
  return res.status(200).json(new ApiResponse(200, msg, 'Message sent'));
});
// Get unreadCounts for current user
const getUnreadCounts = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  return res.status(200).json(new ApiResponse(200, user.unreadCounts || {}, 'Unread counts fetched'));
});
// Reset unread count for a friend
const resetUnreadCount = asyncHandler(async (req, res) => {
  const { friendId } = req.body;
  await User.findByIdAndUpdate(req.user._id, { $set: { [`unreadCounts.${friendId}`]: 0 } });
  return res.status(200).json(new ApiResponse(200, {}, 'Unread count reset'));
});
// Get all messages with a friend
const getMessages = asyncHandler(async (req, res) => {
  const { friendId } = req.params;
  const msgs = await Message.find({
    $or: [
      { from: req.user._id, to: friendId },
      { from: friendId, to: req.user._id }
    ]
  }).sort({ time: 1 });
  return res.status(200).json(new ApiResponse(200, msgs, 'Messages fetched'));
});
// Get last message with a friend
const getLastMessage = asyncHandler(async (req, res) => {
  const { friendId } = req.params;
  const msg = await Message.findOne({
    $or: [
      { from: req.user._id, to: friendId },
      { from: friendId, to: req.user._id }
    ]
  }).sort({ time: -1 });
  return res.status(200).json(new ApiResponse(200, msg, 'Last message fetched'));
});

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccount,
    getAllUsers,
    verifyCode,
    resendCode,
    forgotPassword,
    resetPassword,
    addFriend,
    removeFriend,
    getFriends,
    searchUsers,
    sendFriendRequest,
    getFriendRequests,
    acceptFriendRequest,
    rejectFriendRequest,
    sendMessage,
    getUnreadCounts,
    resetUnreadCount,
    getMessages,
    getLastMessage
}