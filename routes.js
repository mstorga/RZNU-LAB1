const router = require('express').Router(), mongoose = require('mongoose'), Tournament = mongoose.model('Tournament'),
    Win = mongoose.model('Win'), User = mongoose.model('User'),
    passport = require('passport/lib'), jwt = require('express-jwt/lib'), secret = 'secret';

function getTokenFromHeader(req) {
    let headersAuth = req.headers.authorization;
    if (headersAuth) {
        let authArgs = headersAuth.split(' ');
        if (authArgs[0] === 'Token' || authArgs[0] === 'Bearer')
            return authArgs[1];
    }
    return null;
}

const auth = {
    required: jwt({
        secret: secret,
        userProperty: 'payload',
        getToken: getTokenFromHeader
    }),
    optional: jwt({
        secret: secret,
        userProperty: 'payload',
        credentialsRequired: false,
        getToken: getTokenFromHeader
    })
};

router.param('username', function (req, res, next, username) {
    User.findOne({username: username}).then(function (user) {
        if (!user)
            return res.sendStatus(404);
        req.profile = user;
        return next();
    }).catch(next);
});

router.param('tournament', function (req, res, next, slug) {
    Tournament.findOne({slug: slug})
        .populate('organiser')
        .then(function (tournament) {
            if (!tournament)
                return res.sendStatus(404);
            req.tournament = tournament;
            return next();
        }).catch(next);
});

router.param('win', function (req, res, next, id) {
    Win.findById(id).then(function (win) {
        if (!win)
            return res.sendStatus(404);
        req.win = win;
        return next();
    }).catch(next);
});

router.get('/api/user', auth.required, function (req, res, next) {
    User.findById(req.payload.id).then(function (user) {
        if (!user)
            return res.sendStatus(401);
        return res.json({user: user.toAuthJSON()});
    }).catch(next);
});

router.delete('/api/user', auth.required, function (req, res, next) {
    User.findById(req.payload.id).then(function (user) {
        if (!user)
            return res.sendStatus(401);
        return user.remove().then(() => res.sendStatus(204));
    }).catch(next);
});

router.put('/api/user', auth.required, function (req, res, next) {
    User.findById(req.payload.id).then(function (user) {
        if (!user)
            return res.sendStatus(401);
        if (typeof req.body.user.username !== 'undefined')
            user.username = req.body.user.username;
        if (typeof req.body.user.email !== 'undefined')
            user.email = req.body.user.email;
        if (typeof req.body.user.password !== 'undefined')
            user.setPassword(req.body.user.password);

        return user.save().then(function () {
            return res.json({user: user.toAuthJSON()});
        });
    }).catch(next);
});

router.post('/api/users/login', function (req, res, next) {
    if (!req.body.user.email)
        return res.status(422).json({errors: {email: "can't be blank"}});
    if (!req.body.user.password)
        return res.status(422).json({errors: {password: "can't be blank"}});
    passport.authenticate('local', {session: false}, function (err, user, info) {
        if (err)
            return next(err);
        if (user) {
            user.token = user.generateJWT();
            return res.json({user: user.toAuthJSON()});
        } else
            return res.status(422).json(info);
    })(req, res, next);
});

router.post('/api/users', function (req, res, next) {
    const user = new User();
    user.username = req.body.user.username;
    user.email = req.body.user.email;
    user.setPassword(req.body.user.password);
    user.save().then(() => res.json({user: user.toAuthJSON()})
    ).catch(next);
});

router.get('/api/users/:username', auth.optional, function (req, res, next) {
    if (req.payload)
        User.findById(req.payload.id).then(function (user) {
            if (!user)
                return res.json({profile: req.profile.toProfileJSONFor(false)});
            return res.json({profile: req.profile.toProfileJSONFor(user)});
        });
    else
        return res.json({profile: req.profile.toProfileJSONFor(false)});
});

router.get('/api/tournaments', auth.required, function (req, res, next) {
    const query = {};
    let limit = 20;
    let offset = 0;
    if (typeof req.query.limit !== 'undefined')
        limit = req.query.limit;
    if (typeof req.query.offset !== 'undefined')
        offset = req.query.offset;
    Promise.all([
        req.query.organiser ? User.findOne({username: req.query.organiser}) : null,
    ]).then(function (results) {
        const organiser = results[0];
        if (organiser)
            query.organiser = organiser._id;
        return Promise.all([
            Tournament.find(query)
                .limit(Number(limit))
                .skip(Number(offset))
                .sort({createdAt: 'desc'})
                .populate('organiser')
                .exec(),
            Tournament.count(query).exec(),
            req.payload ? User.findById(req.payload.id) : null
        ]).then(function (results) {
            const tournaments = results[0];
            const tournamentsCount = results[1];
            const user = results[2];
            return res.json({
                tournaments: tournaments.map(tournament => tournament.toJSONFor(user)),
                tournamentsCount: tournamentsCount
            });
        });
    }).catch(next);
});

router.post('/api/tournaments', auth.required, function (req, res, next) {
    User.findById(req.payload.id).then(function (user) {
        if (!user)
            return res.sendStatus(401);
        const tournament = new Tournament(req.body.tournament);
        tournament.organiser = user;
        return tournament.save().then(function () {
            console.log(tournament.organiser);
            return res.json({tournament: tournament.toJSONFor(user)});
        });
    }).catch(next);
});

router.get('/api/tournaments/:tournament', auth.optional, function (req, res, next) {
    Promise.all([
        req.payload ? User.findById(req.payload.id) : null,
        req.tournament.populate('organiser').execPopulate()
    ]).then(function (results) {
        const user = results[0];
        return res.json({tournament: req.tournament.toJSONFor(user)});
    }).catch(next);
});

router.put('/api/tournaments/:tournament', auth.required, function (req, res, next) {
    User.findById(req.payload.id).then(function (user) {
        if (req.tournament.organiser._id.toString() === req.payload.id.toString()) {
            if (typeof req.body.tournament.title !== 'undefined')
                req.tournament.title = req.body.tournament.title;
            if (typeof req.body.tournament.description !== 'undefined')
                req.tournament.description = req.body.tournament.description;
            if (typeof req.body.tournament.body !== 'undefined')
                req.tournament.body = req.body.tournament.body;

            req.tournament.save().then(tournament => res.json({tournament: tournament.toJSONFor(user)})).catch(next);
        } else
            return res.sendStatus(403);
    });
});

router.delete('/api/tournaments/:tournament', auth.required, function (req, res, next) {
    User.findById(req.payload.id).then(function (user) {
        if (!user)
            return res.sendStatus(401);
        if (req.tournament.organiser._id.toString() === req.payload.id.toString())
            return req.tournament.remove().then(() => res.sendStatus(204));
        else
            return res.sendStatus(403);
    }).catch(next);
});

router.get('/api/tournaments/:tournament/wins', auth.optional, function (req, res, next) {
    Promise.resolve(req.payload ? User.findById(req.payload.id) : null).then(function (user) {
        return req.tournament.populate({
            path: 'wins',
            populate: {
                path: 'fighter'
            },
            options: {
                sort: {
                    createdAt: 'desc'
                }
            }
        }).execPopulate().then(function (tournament) {
            return res.json({
                wins: req.tournament.wins.map(win => win.toJSONFor(user))
            });
        });
    }).catch(next);
});

router.post('/api/tournaments/:tournament/wins', auth.required, function (req, res, next) {
    User.findById(req.payload.id).then(function (user) {
        if (!user)
            return res.sendStatus(401);
        const win = new Win(req.body.win);
        win.tournament = req.tournament;
        win.fighter = user;
        return win.save().then(function () {
            req.tournament.wins.push(win);
            return req.tournament.save().then(function (tournament) {
                res.json({win: win.toJSONFor(user)});
            });
        });
    }).catch(next);
});

router.delete('/api/tournaments/:tournament/wins/:win', auth.required, function (req, res, next) {
    if (req.win.fighter.toString() === req.payload.id.toString()) {
        req.tournament.wins.remove(req.win._id);
        req.tournament.save()
            .then(Win.find({_id: req.win._id}).remove().exec())
            .then(function () {
                res.sendStatus(204);
            });
    } else
        res.sendStatus(403);
});

router.use(function (err, req, res, next) {
    if (err.name === 'ValidationError')
        return res.status(422).json({
            errors: Object.keys(err.errors).reduce(function (errors, key) {
                errors[key] = err.errors[key].message;
                return errors;
            }, {})
        });
    return next(err);
});

module.exports = router;
