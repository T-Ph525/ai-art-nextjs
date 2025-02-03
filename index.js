// init project
const express = require("express");
const bp = require("body-parser");
const { Pool } = require("pg");
const AWS = require("aws-sdk");
const multer = require("multer");
const multerS3 = require("multer-s3");
const querystring = require("querystring");

// Firebase config
const serviceAccount = require("./serviceAccountKey.json");
const admin = require("firebase-admin");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// App config
const app = express();
app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

require("dotenv").config();

const port = process.env.PORT || 3000;

const DEFAULT_AVATAR =
    "https://user-images.githubusercontent.com/79369571/182101394-89e63593-11a1-4aed-8ec5-9638d9c62a81.png";

// GUEST
const pool = new Pool({
    /* MUST CONFIG */
    connectionString: process.env.DB_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

// Get user info from database with jwt firebase token
const fetchUserInfo = async (token) => {
    console.log("token", { token });

    try {
        // 1) Extracts token
        const decodedToken = await admin.auth().verifyIdToken(token);

        console.log("decodedToken", { decodedToken });

        const { email, uid } = decodedToken;
        const userAuth = await admin.auth().getUser(uid);

        // 2) Fetches userInfo in a mock function
        const userRes = await pool.query(
            'SELECT * FROM public."User" WHERE email=$1',
            [email]
        );

        let users = userRes.rows;
        if (!users || users.length === 0) {
            try {
                const insertUserRes = await pool.query(
                    'INSERT INTO public."User" (uuid, name, email, avatar) VALUES ($1, $2, $3, $4) RETURNING *',
                    [
                        uid,
                        userAuth.displayName ?? email,
                        email,
                        decodedToken.picture ?? DEFAULT_AVATAR,
                    ]
                );
                users = insertUserRes.rows;
            } catch (error) {
                const userRes2 = await pool.query(
                    'SELECT * FROM public."User" WHERE email=$1',
                    [email]
                );

                users = userRes2.rows;
            }
        }

        // 3) Return hasura variables
        return users;
    } catch (error) {
        console.log({ error });
        return error;
    }
};

// GET: Hasura user information
app.get("/", async (request, response) => {
    try {
        // Extract token from request
        let token = request.get("Authorization");
        token = token.replace(/^Bearer\s/, "");

        // Fetch user_id that is associated with this token
        const users = await fetchUserInfo(token);

        let hasuraVariables = {};

        if (users.length > 0) {
            hasuraVariables = {
                "X-Hasura-Role": "user",
                "X-Hasura-User-Id": `${users[0].id}`,
            };
        }

        // Return appropriate response to Hasura
        response.json(hasuraVariables);
    } catch (error) {
        response.json({ error });
    }
});

// GET: trigger webhook get or create user when login
app.get("/webhook", async (request, response) => {
    // Extract token from request
    let token = request.get("Authorization");
    token = token.replace(/^Bearer\s/, "");

    // Fetch user_id that is associated with this token
    const user = await fetchUserInfo(token);

    // response.json({ token, user });

    let hasuraVariables = {};

    if (user.length > 0) {
        hasuraVariables = {
            "X-Hasura-Role": "user",
            "X-Hasura-User-Id": `${user[0].id}`,
        };
    }

    // Return appropriate response to Hasura
    response.json(hasuraVariables);
});

// POST: Callback for sign in with apple
app.post("/callback", async (request, response) => {
    const redirect = `intent://callback?${new URLSearchParams(
        request.body
        /* MUST CONFIG */
    ).toString()}#Intent;package=dev.ditustudio.ai_art;scheme=signinwithapple;end`;

    response.redirect(307, redirect);
});

// const spacesEndpoint = new AWS.Endpoint(process.env.DO_SPACES_ENDPOINT);
// const s3 = new AWS.S3({
//     region: "nyc3",
//     endpoint: spacesEndpoint,
//     accessKeyId: process.env.DO_SPACES_KEY,
//     secretAccessKey: process.env.DO_SPACES_SECRET,
// });

// const upload = multer({
//     storage: multerS3({
//         s3: s3,
//         bucket: process.env.DO_SPACES_NAME,
//         acl: "public-read",
//         key: function (request, file, cb) {
//             console.log(file);
//             cb(null, `${process.env.DO_SPACES_NAME_APP}/${file.originalname}`);
//         },
//     }),
// }).array("file", 1);

// // POST: Upload File
// app.post("/upload_file", async (request, response) => {
//     upload(request, response, function (error) {
//         if (error) {
//             console.log(error);
//             return response.json({
//                 statusCode: 400,
//             });
//         }
//         console.log("File uploaded successfully.");
//         response.json({
//             statusCode: 200,
//             link: request.files[0].location,
//         });
//     });
// });

// // POST: Delete File
// app.post("/delete_file", async (request, response) => {
//     var linkImage = request.body.linkImage;
//     try {
//         const parts = linkImage.split("/");
//         const key = parts[parts.length - 1];
//         const decodedKey = querystring.unescape(key);
//         const params = {
//             Bucket: `${process.env.DO_SPACES_NAME}`,
//             Key: `${process.env.DO_SPACES_NAME_APP}/${decodedKey}`,
//         };
//         s3.deleteObject(params, (err, data) => {
//             if (err) {
//                 console.log("Error deleting object:", err);
//                 response.json({
//                     statusCode: 400,
//                 });
//             } else {
//                 console.log("Object deleted successfully.");
//                 response.json({
//                     statusCode: 200,
//                 });
//             }
//         });
//     } catch (error) {
//         response.json({
//             statusCode: 400,
//         });
//     }
// });

// // POST: Delete Multi Files
// app.post("/delete_multi_file", async (request, response) => {
//     var params = {
//         Bucket: `${process.env.DO_SPACES_NAME}`,
//         Delete: { Objects: [] },
//     };
//     for (const [_, value] of Object.entries(request.body)) {
//         const parts = value.split("/");
//         const key = parts[parts.length - 1];
//         const decodedKey = querystring.unescape(key);
//         params.Delete.Objects.push({
//             Key: `${process.env.DO_SPACES_NAME_APP}/${decodedKey}`,
//         });
//     }
//     try {
//         s3.deleteObjects(params, (err, data) => {
//             if (err) {
//                 console.log("Error deleting object:", err);
//                 response.json({
//                     statusCode: 400,
//                 });
//             } else {
//                 console.log("Object deleted successfully.");
//                 response.json({
//                     statusCode: 200,
//                 });
//             }
//         });
//     } catch (error) {
//         response.json({
//             statusCode: 400,
//         });
//     }
// });

// listen for requests :)
app.listen(port, function () {
    console.log("Your app is listening on port " + port);
});

// Export the Express API
module.exports = app;
