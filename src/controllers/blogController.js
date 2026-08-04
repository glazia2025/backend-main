// const Blog = require("../models/Blog");

// const getBlogData = (body) => ({
//   title: body.title,
//   slug: body.slug,
//   category: body.category,
//   image: body.image || "",
//   date: body.date,
//   readTime: body.readTime,
//   views: Number(body.views || 0),
//   likes: Number(body.likes || 0),
//   comments: Number(body.comments || 0),
//   share: Number(body.share || 0),
//   content: body.content,
// });

// const getBlogs = async (req, res) => {
//   try {
//     const blogs = await Blog.find().sort({ createdAt: -1 });

//     return res.status(200).json(blogs);
//   } catch (error) {
//     console.error(error);

//     return res.status(500).json({
//       message: error.message,
//     });
//   }
// };

// // CREATE BLOG
// const createBlog = async (req, res) => {
//   try {
//     const {
//       title,
//       slug,
//       category,
//       image,
//       date,
//       readTime,
//       views,
//       likes,
//       comments,
//       share,
//       content,
//     } = req.body;

//     // Required validation
//     if (
//       !title ||
//       !slug ||
//       !category ||
//       !date ||
//       !readTime ||
//       !Array.isArray(content)
//     ) {
//       return res.status(400).json({
//         message: "Required fields are missing",
//       });
//     }

//     // Check duplicate slug
//     const existingBlog = await Blog.exists({ slug });

//     if (existingBlog) {
//       return res.status(400).json({
//         message: "Blog with this slug already exists",
//       });
//     }

//     const blog = await Blog.create(
//       getBlogData({
//         title,
//         slug,
//         category,
//         image,
//         date,
//         readTime,
//         views,
//         likes,
//         comments,
//         share,
//         content,
//       })
//     );

//     return res.status(201).json({
//       success: true,
//       message: "Blog created successfully",
//       ...blog.toJSON(),
//     });
//   } catch (error) {
//     console.error(error);

//     return res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// const updateBlog = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const blog = await Blog.findById(id);

//     if (!blog) {
//       return res.status(404).json({
//         success: false,
//         message: "Blog not found",
//       });
//     }

//     const {
//       title,
//       slug,
//       category,
//       image,
//       date,
//       readTime,
//       views,
//       likes,
//       comments,
//       share,
//       content,
//     } = req.body;

//     // Check duplicate slug (ignore current blog)
//     const duplicate = await Blog.exists({ slug, _id: { $ne: id } });

//     if (duplicate) {
//       return res.status(400).json({
//         success: false,
//         message: "Blog with this slug already exists",
//       });
//     }

//     Object.assign(
//       blog,
//       getBlogData({
//         title,
//         slug,
//         category,
//         image,
//         date,
//         readTime,
//         views,
//         likes,
//         comments,
//         share,
//         content,
//       })
//     );
//     await blog.save();

//     return res.status(200).json({
//       success: true,
//       message: "Blog updated successfully",
//     });
//   } catch (error) {
//     console.error("UPDATE ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };
// const deleteBlog = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const blog = await Blog.findByIdAndDelete(id);

//     if (!blog) {
//       return res.status(404).json({
//         success: false,
//         message: "Blog not found",
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Blog deleted successfully",
//     });
//   } catch (error) {
//     console.error("DELETE ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// const getBlogById = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const blog = await Blog.findById(id);

//     if (!blog) {
//       return res.status(404).json({
//         success: false,
//         message: "Blog not found",
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       data: blog,
//     });
//   } catch (error) {
//     console.error("GET BLOG BY ID ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// module.exports = {
//   getBlogs,
//   getBlogById,
//   createBlog,
//   updateBlog,
//   deleteBlog,
// };


const db = require("../config/firebaseAdmin");
const getBlogs = async (req, res) => {
  try {
    const snapshot = await db.collection("blogs").get();

    const blogs = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.status(200).json(blogs);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

// CREATE BLOG
const createBlog = async (req, res) => {
  try {
    const {
      title,
      slug,
      category,
      image,
      date,
      readTime,
      views,
      likes,
      comments,
      share,
      content,
    } = req.body;

    // Required validation
    if (
      !title ||
      !slug ||
      !category ||
      !date ||
      !readTime ||
      !Array.isArray(content)
    ) {
      return res.status(400).json({
        message: "Required fields are missing",
      });
    }

    // Check duplicate slug
    const existingBlog = await db
      .collection("blogs")
      .where("slug", "==", slug)
      .limit(1)
      .get();

    if (!existingBlog.empty) {
      return res.status(400).json({
        message: "Blog with this slug already exists",
      });
    }

    const blogData = {
      title,
      slug,
      category,
      image: image || "",
      date,
      readTime,
      views: Number(views || 0),
      likes: Number(likes || 0),
      comments: Number(comments || 0),
      share: Number(share || 0),
      content,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const docRef = await db.collection("blogs").add(blogData);

    return res.status(201).json({
      success: true,
      message: "Blog created successfully",
      id: docRef.id,
       ...blogData,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updateBlog = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("========== UPDATE BLOG ==========");
    console.log("PARAM ID:", id);

    const blogRef = db.collection("blogs").doc(id);

    const blogDoc = await blogRef.get();

    console.log("BLOG EXISTS:", blogDoc.exists);

    const allDocs = await db.collection("blogs").get();

    console.log("ALL DOC IDS:");
    allDocs.forEach((doc) => console.log(doc.id));

    // Check if blog exists
    if (!blogDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    const {
      title,
      slug,
      category,
      image,
      date,
      readTime,
      views,
      likes,
      comments,
      share,
      content,
    } = req.body;

    // Check duplicate slug (ignore current blog)
    const existing = await db
      .collection("blogs")
      .where("slug", "==", slug)
      .get();

    const duplicate = existing.docs.find((doc) => doc.id !== id);

    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: "Blog with this slug already exists",
      });
    }

    const updatedBlog = {
      title,
      slug,
      category,
      image: image || "",
      date,
      readTime,
      views: Number(views || 0),
      likes: Number(likes || 0),
      comments: Number(comments || 0),
      share: Number(share || 0),
      content,
      updatedAt: new Date(),
    };

    await blogRef.update(updatedBlog);

    return res.status(200).json({
      success: true,
      message: "Blog updated successfully",
    });
  } catch (error) {
    console.error("UPDATE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const deleteBlog = async (req, res) => {
  try {
    const { id } = req.params;

    const blogRef = db.collection("blogs").doc(id);

    const blogDoc = await blogRef.get();

    // Check if blog exists
    if (!blogDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    await blogRef.delete();

    return res.status(200).json({
      success: true,
      message: "Blog deleted successfully",
    });
  } catch (error) {
    console.error("DELETE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getBlogById = async (req, res) => {
  try {
    const { id } = req.params;

    const blogRef = db.collection("blogs").doc(id);

    const blogDoc = await blogRef.get();

    if (!blogDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: blogDoc.id,
        ...blogDoc.data(),
      },
    });
  } catch (error) {
    console.error("GET BLOG BY ID ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getBlogs,
  getBlogById,
  createBlog,
  updateBlog,
  deleteBlog,
};
