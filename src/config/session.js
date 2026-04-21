const session = require("express-session");
const MongoStore = require("connect-mongo");

const createSessionMiddleware = () => {
  const isProduction = process.env.NODE_ENV === "production";
  
  return session({
    secret: process.env.SESSION_SECRET || "viramah-dev-session-secret-do-not-use-in-prod",
    resave: false,
    saveUninitialized: false,
    proxy: isProduction, // Trust X-Forwarded-Proto from nginx/ALB for secure cookies
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      dbName: process.env.DB_NAME || "viramah",
      collectionName: "sessions",
      ttl: 24 * 60 * 60,
      mongoOptions: !isProduction ? { tlsAllowInvalidCertificates: true } : {},
    }),
    cookie: {
      httpOnly: true,
      secure: isProduction,
      maxAge: 24 * 60 * 60 * 1000,
      // Cross-site: admin on amplifyapp.com needs to send cookies to api.viramahstay.com.
      // sameSite "none" + secure is required for cross-site cookie delivery.
      // Do NOT set domain — let it default to the API host. Setting domain to
      // .viramahstay.com breaks when the frontend is on a different registrable
      // domain (amplifyapp.com). Once you add a custom domain (admin.viramahstay.com),
      // you can optionally add: domain: ".viramahstay.com"
      sameSite: isProduction ? "none" : "lax",
      path: "/",
    },
  });
};

module.exports = createSessionMiddleware;
