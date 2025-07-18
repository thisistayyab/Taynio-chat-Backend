import { Router } from "express";
import { changeCurrentPassword, getCurrentUser, loginUser, logoutUser, refreshAccessToken, registerUser, updateAccount, getAllUsers, verifyCode, resendCode, forgotPassword, resetPassword, addFriend, removeFriend, getFriends, searchUsers, sendFriendRequest, getFriendRequests, acceptFriendRequest, rejectFriendRequest, sendMessage, getMessages, getLastMessage, getUnreadCounts, resetUnreadCount } from "../controllers/user.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = Router()

router.route("/register").post(registerUser)
router.route("/login").post(loginUser)
router.route("/logout").post(verifyJWT,logoutUser)
router.route("/refresh-token").post(refreshAccessToken)
router.route("/change-password").post(verifyJWT,changeCurrentPassword)
router.route("/get-user").get(verifyJWT,getCurrentUser)
router.route("/update-account").patch(verifyJWT, upload.single("profilepic"), updateAccount)
router.route("/all").get(getAllUsers)
router.route("/verify-code").post(verifyCode)
router.route("/resend-code").post(resendCode)
router.route("/forgot-password").post(forgotPassword)
router.route("/reset-password").post(resetPassword)
router.route("/add-friend").post(verifyJWT, addFriend);
router.route("/remove-friend").post(verifyJWT, removeFriend);
router.route("/friends").get(verifyJWT, getFriends);
router.route("/search-users").get(verifyJWT, searchUsers);
router.route('/send-friend-request').post(verifyJWT, sendFriendRequest);
router.route('/friend-requests').get(verifyJWT, getFriendRequests);
router.route('/accept-friend-request').post(verifyJWT, acceptFriendRequest);
router.route('/reject-friend-request').post(verifyJWT, rejectFriendRequest);
router.route('/messages/send').post(verifyJWT, sendMessage);
router.route('/messages/:friendId').get(verifyJWT, getMessages);
router.route('/messages/last/:friendId').get(verifyJWT, getLastMessage);
router.route('/unread-counts').get(verifyJWT, getUnreadCounts);
router.route('/reset-unread').post(verifyJWT, resetUnreadCount);

// Test route for debugging
router.route("/test").get((req, res) => {
    res.json({ 
        message: "Backend is working", 
        cookies: req.cookies,
        headers: req.headers
    });
});

export {router}