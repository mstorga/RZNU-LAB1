const mongoose = require('mongoose'), uniqueValidator = require('mongoose-unique-validator'), slug = require('slug'),
    crypto = require('crypto'), jwt = require('jsonwebtoken'), secret = 'secret';

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        lowercase: true,
        unique: true,
        required: [true, "can't be blank"],
        match: [/^[a-zA-Z0-9]+$/, 'is invalid'],
        index: true
    },
    email: {
        type: String,
        lowercase: true,
        unique: true,
        required: [true, "can't be blank"],
        match: [/\S+@\S+\.\S+/, 'is invalid'],
        index: true
    },
    hash: String,
    salt: String
}, {timestamps: true});

UserSchema.plugin(uniqueValidator, {message: 'is already taken.'});

UserSchema.methods = {
    validPassword: function (password) {
        const hash = crypto.pbkdf2Sync(password, this.salt, 10000, 512, 'sha512').toString('hex');
        return this.hash === hash;
    }, setPassword: function (password) {
        this.salt = crypto.randomBytes(16).toString('hex');
        this.hash = crypto.pbkdf2Sync(password, this.salt, 10000, 512, 'sha512').toString('hex');
    }, generateJWT: function () {
        const exp = new Date();
        exp.setDate(new Date().getDate() + 30);
        return jwt.sign({
            id: this._id,
            username: this.username,
            exp: parseInt(exp.getTime() / 1000),
        }, secret);
    }, toAuthJSON: function () {
        return {
            username: this.username,
            email: this.email,
            token: this.generateJWT(),
        };
    }, toProfileJSONFor: function (user) {
        return {
            username: this.username
        };
    }
};

mongoose.model('User', UserSchema);
let User = mongoose.model('User');
const TournamentSchema = new mongoose.Schema({
    slug: {type: String, lowercase: true, unique: true},
    title: String,
    body: String,
    wins: [{type: mongoose.Schema.Types.ObjectId, ref: 'Win'}],
    organiser: {type: mongoose.Schema.Types.ObjectId, ref: 'User'}
}, {timestamps: true});

TournamentSchema.plugin(uniqueValidator, {message: 'is already taken'});

TournamentSchema.pre('validate', function (next) {
    if (!this.slug) {
        this.slugify();
    }

    next();
});

TournamentSchema.methods = {
    slugify: function () {
        this.slug = slug(this.title) + '-' + (Math.random() * Math.pow(36, 6) | 0).toString(36);
    }, toJSONFor: function (user) {
        return {
            slug: this.slug,
            title: this.title,
            description: this.description,
            body: this.body,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            organiser: this.organiser.toProfileJSONFor(user)
        };
    }
};

mongoose.model('Tournament', TournamentSchema);

const WinSchema = new mongoose.Schema({
    body: String,
    fighter: {type: mongoose.Schema.Types.ObjectId, ref: 'User'},
    tournament: {type: mongoose.Schema.Types.ObjectId, ref: 'Tournament'}
}, {timestamps: true});

WinSchema.methods.toJSONFor = function (user) {
    return {
        id: this._id,
        body: this.body,
        createdAt: this.createdAt,
        fighter: this.fighter.toProfileJSONFor(user)
    };
};

mongoose.model('Win', WinSchema);
