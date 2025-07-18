import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'

const userSchema = new mongoose.Schema({
    username: {
        type:String, 
        required:true,
        unique:true
    },
    email: {
        type:String, 
        required:true,
        unique:true
    },
    password: {
        type:String, 
        required:true,
        unique:true
    },
    fullname:{
        type:String,
        required:true
    },
    profilepic:{
        type:String, 
        default:""
    },
    phone:{
        type:Number,
    },
    address:{
        type:String,
    },
    refreshToken: {
        type: String
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    verificationCode: {
        type: String
    },
    verificationCodeExpires: {
        type: Date
    },
    friends: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: []
    }],
    unreadCounts: {
        type: Map,
        of: Number,
        default: {}
    }
})

userSchema.pre("save", async function(next){
    if(!this.isModified("password"))return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
})

userSchema.methods.isPasswordCorrect = async function(password){
    return await bcrypt.compare(password,this.password)
}

userSchema.methods.generateAccessToken = function (){
    try {
        if (!process.env.ACCESS_TOKEN_SECRET) {
            throw new Error("ACCESS_TOKEN_SECRET environment variable is not set");
        }
        return jwt.sign(
            {
                _id:this._id,
                email:this.email,
                username:this.username,     
                fullname:this.fullname
            },
            process.env.ACCESS_TOKEN_SECRET,
            {
                expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '1d'
            }
        )
    } catch (error) {
        throw error;
    }
}
userSchema.methods.generateRefreshToken = function (){
    try {
        if (!process.env.REFRESH_TOKEN_SECRET) {
            throw new Error("REFRESH_TOKEN_SECRET environment variable is not set");
        }
        return jwt.sign(
            {
                _id:this._id,
            },
            process.env.REFRESH_TOKEN_SECRET,
            {
                expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d'
            }
        )
    } catch (error) {
        throw error;
    }
}

userSchema.methods.generateVerificationCode = function () {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.verificationCode = code;
    this.verificationCodeExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
    return code;
};

userSchema.methods.clearVerificationCode = function () {
    this.verificationCode = undefined;
    this.verificationCodeExpires = undefined;
};


export const User = mongoose.model('User', userSchema)