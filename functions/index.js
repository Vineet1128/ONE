const functions = require("firebase-functions");
const admin = require("firebase-admin");
const webpush = require("web-push");

admin.initializeApp();

// It's recommended to store VAPID keys in Firebase environment variables
// For this example, I'm using a placeholder. You'll need to set this.
// firebase functions:config:set webpush.private_key="YOUR_VAPID_PRIVATE_KEY"
const VAPID_PRIVATE_KEY = functions.config().webpush?.private_key || process.env.VAPID_PRIVATE_KEY;
const VAPID_PUBLIC_KEY = "BPpJyJX0nHDwJeb1_MfEitAebbQBPtK58SisZAlzxKblgjPIfq9Slzzm2SvJTlxsl7ofq6iEs5H3p6yYowhQscU";

webpush.setVapidDetails(
  "mailto:example@yourdomain.org",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

/**
 * Sends a test push notification to a specific user.
 * This is an HTTP-triggered function, you can call it from your browser:
 * .../sendTestNotification?uid=USER_ID_HERE
 */
exports.sendTestNotification = functions.https.onRequest(async (req, res) => {
  const userId = req.query.uid;
  if (!userId) {
    return res.status(400).send("Missing 'uid' query parameter.");
  }

  try {
    const userDoc = await admin.firestore().collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).send("User not found.");
    }

    const userData = userDoc.data();
    const subscriptions = userData.pushSubscriptions || [];

    if (subscriptions.length === 0) {
      return res.status(404).send("No push subscriptions found for this user.");
    }

    const payload = JSON.stringify({
      title: "Test Notification from ONE",
      body: "Hello! If you received this, push notifications are working.",
      icon: "/assets/common/logo.png",
    });

    const promises = subscriptions.map(sub => webpush.sendNotification(sub, payload));
    await Promise.all(promises);

    res.status(200).send(`Sent ${promises.length} notifications to user ${userId}.`);

  } catch (error) {
    console.error("Failed to send test notification:", error);
    res.status(500).send("An error occurred while sending notifications.");
  }
});
