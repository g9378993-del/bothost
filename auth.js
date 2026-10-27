/**
 * Middleware simple : vérifie le header Authorization: Bearer <API_SECRET>
 * Render génère automatiquement la valeur de API_SECRET via generateValue: true
 */
function requireAuth(req, res, next) {
  const secret = process.env.API_SECRET;
  if (!secret) return next(); // pas de secret configuré = pas d'auth (dev local)

  const auth = req.headers['authorization'];
  if (!auth || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireAuth };
