let express = require('express'),
    bodyParser = require('body-parser'),
    session = require('express-session'),
    cors = require('cors'),
    errorHandler = require('errorhandler'),
    mongoose = require('mongoose');

let app = express();

app.use(cors());

app.use(require('morgan')('dev'));
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());

app.use(require('method-override')());
app.use(express.static(__dirname + '/public'));

app.use(session({secret: 'jiu', cookie: {maxAge: 60000}, resave: false, saveUninitialized: false}));
app.use(errorHandler());

mongoose.connect('mongodb://localhost/jiu');
mongoose.set('debug', true);
require('./models.js');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const User = mongoose.model('User');

passport.use(new LocalStrategy({
  usernameField: 'user[email]',
  passwordField: 'user[password]'
}, function(email, password, done) {
  User.findOne({email: email}).then(function(user){
    if(!user || !user.validPassword(password)){
      return done(null, false, {errors: {'email or password': 'is invalid'}});
    }

    return done(null, user);
  }).catch(done);
}));
app.use(require('./routes.js'));

app.use(function (req, res, next) {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

app.use(function (err, req, res) {
  console.log(err.stack);
  res.status(err.status || 500);
  res.json({
    'errors': {
      message: err.message,
      error: err
    }
  });
});

const server = app.listen(process.env.PORT || 3000, function () {
  console.log('Listening on port ' + server.address().port);
});
