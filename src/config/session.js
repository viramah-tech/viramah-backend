const session = require("express-session");
const MongoStore = require("connect-mongo");

const createSessionMiddleware = () => {
  return session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      dbName: process.env.DB_NAME || "viramah",
      collectionName: "sessions",
      ttl: 24 * 60 * 60,
      mongoOptions: process.env.NODE_ENV !== "production" ? { tlsAllowInvalidCertificates: true } : {},
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "lax",
      // Allow cookie to be shared across ports in development
      domain: process.env.NODE_ENV === "production" ? undefined : "localhost",
      path: "/",
    },
  });
};

module.exports = createSessionMiddleware;
