const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

passport.use(new GitHubStrategy({
  clientID: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL || 'https://bothost-r95c.onrender.com/auth/github/callback'
}, (accessToken, refreshToken, profile, done) => {
  db.get('SELECT * FROM users WHERE github_id = ?', [profile.id], (err, user) => {
    if (user) return done(null, user);
    const newUser = {
      id: uuidv4(),
      github_id: profile.id,
      username: profile.username,
      avatar: profile.photos?.[0]?.value || ''
    };
    db.run('INSERT INTO users (id, github_id, username, avatar) VALUES (?, ?, ?, ?)',
      [newUser.id, newUser.github_id, newUser.username, newUser.avatar],
      () => done(null, newUser)
    );
  });
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => done(err, user));
});

module.exports = passport;
