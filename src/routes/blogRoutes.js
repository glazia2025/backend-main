const express = require("express");
const router = express.Router();
const db = require("../config/firebaseAdmin");

router.use((_req, res, next) => {
  if (!db) return res.status(503).json({ message: "Blogs are unavailable locally because Firebase credentials are not configured." });
  return next();
});

const {
  getBlogs,
  getBlogById,
  createBlog,
  updateBlog,
  deleteBlog,
} = require("../controllers/blogController");

router.get("/", getBlogs);
router.get("/:id", getBlogById);
router.post("/", createBlog);
router.put("/:id", updateBlog);
router.delete("/:id", deleteBlog);

module.exports = router;
