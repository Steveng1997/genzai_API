const router = require("express").Router();
const callController = require("../controllers/callController");

router.post("/vapi", callController.vapiWebhook);
router.get("/meta", (req, res) => {
  if (req.query["hub.verify_token"] === process.env.WEBHOOK_VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

module.exports = router;
