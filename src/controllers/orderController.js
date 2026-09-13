const { UserOrder, Nalco } = require("../models/Order");
const User = require("../models/User");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const fs = require("fs");
const { extractQueryParams, escapeRegExp } = require("../utils/common");
const { sendNalcoMessageToUsers } = require("../utils/nalcoWhatsapp");
const { consumeStock, addStock } = require("../services/dealershipInventoryService");

const createOrder = async (req, res) => {
  const { products, payment, totalAmount, deliveryType, orderChannel, sourceOrderId,} = req.body;
  if (
    !products ||
    !Array.isArray(products) ||
    products.length === 0 ||
    !payment ||
    !payment.amount ||
    !payment.proof ||
    !totalAmount ||
    products.some((product) => !product.productId || !Number.isFinite(Number(product.quantity)) || Number(product.quantity) <= 0)
  ) {
    return res
      .status(400)
      .json({ message: "Please select products to proceed" });
  }

  try {
    const authenticatedUser = req.user?.userId
      ? await User.findById(req.user.userId).lean()
      : req.user?.phoneNumber
        ? await User.findOne({
          $or: [
            { phoneNumber: req.user.phoneNumber },
            { phoneNumbers: req.user.phoneNumber },
          ],
        }).lean()
        : null;

    if (!authenticatedUser) {
      return res.status(400).json({
        message: "Authenticated user profile could not be found. Please log in again.",
      });
    }

    const orderUser = {
      userId: authenticatedUser._id,
      name: authenticatedUser.name,
      city: authenticatedUser.city,
      phoneNumber: authenticatedUser.phoneNumber,
    };

    const isDealership = authenticatedUser.accountType === "DEALERSHIP";
    const isDealerGlaziaOrder =
  isDealership &&
  orderChannel === "DEALER_DIRECT_FULFILLMENT" && sourceOrderId;
    const assignedDealership = authenticatedUser.dealership || (isDealership ? authenticatedUser._id : null);

    const newOrder = new UserOrder({
      user: orderUser,
      products,
      payments: [
        {
          amount: payment.amount,
          proof: payment.proof,
          proofAdded: true,
          cycle: 1,
          isApproved: false,
        },
      ],
      totalAmount,
      deliveryType,
      dealership: assignedDealership,
      fulfillment: {
  status: isDealerGlaziaOrder
    ? "GLAZIA_DIRECT"
    : authenticatedUser.dealership
      ? "AWAITING_DEALER"
      : "GLAZIA_DIRECT",
},

orderChannel: isDealerGlaziaOrder
  ? "DEALER_DIRECT_FULFILLMENT"
  : "CUSTOMER",

inventoryDisposition: isDealerGlaziaOrder
  ? "DIRECT_TO_FABRICATOR"
  : isDealership
    ? "ADD_TO_DEALER_STOCK"
    : "NONE",
    sourceOrder: isDealerGlaziaOrder
  ? sourceOrderId
  : null,

      deliveryAddress: {
        name: authenticatedUser.name,
        phoneNumber: authenticatedUser.phoneNumber,
        address: authenticatedUser.address,
        city: authenticatedUser.city,
        state: authenticatedUser.state,
        pincode: authenticatedUser.pincode,
      },
    });
    const savedOrder = await newOrder.save();

    if (authenticatedUser.dealership && !isDealerGlaziaOrder) {
  const stockResult = await consumeStock(
    authenticatedUser.dealership,
    products,
    savedOrder._id
  );

  if (stockResult.fulfilledFromStock) {
    savedOrder.fulfillment.status = "DEALER_STOCK";
    savedOrder.fulfillment.decidedAt = new Date();
    savedOrder.fulfillment.decidedBy = authenticatedUser.dealership;
    savedOrder.inventoryDisposition = "CONSUMED_FROM_DEALER_STOCK";
    savedOrder.fulfillment.remainingProducts = [];
  } else {
    savedOrder.fulfillment.status = "GLAZIA_VIA_DEALER";
    savedOrder.fulfillment.decidedAt = new Date();
    savedOrder.fulfillment.decidedBy = authenticatedUser.dealership;

    if (stockResult.consumedProducts.length > 0) {
      savedOrder.inventoryDisposition = "CONSUMED_FROM_DEALER_STOCK";
    }
    savedOrder.fulfillment.remainingProducts =
  stockResult.remainingProducts;
  }

  await savedOrder.save();
}
    if (isDealerGlaziaOrder) {
  if (!mongoose.isValidObjectId(sourceOrderId)) {
    return res.status(400).json({
      message: "Invalid source order ID",
    });
  }

  const sourceOrder = await UserOrder.findOne({
    _id: sourceOrderId,
    dealership: authenticatedUser._id,
    "fulfillment.status": "GLAZIA_VIA_DEALER",
  });

  if (!sourceOrder) {
    return res.status(404).json({
      message: "Original dealership order not found",
    });
  }

  sourceOrder.upstreamOrder = savedOrder._id;
  await sourceOrder.save();
}

    res.status(201).json({
      message: "Order created successfully.",
      order: savedOrder,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

const getOrders = async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    let { page, limit, filters, sortObj } = extractQueryParams(req.query);

    let query = {
      totalAmount: { $exists: true },
    };
    let skip = (page - 1) * limit;

    if (user && user.role !== "admin") {
      query["user.userId"] = user.userId;
    }
//     if (user && user.role === "admin") {
//   query["fulfillment.status"] = "GLAZIA_DIRECT";
// }
if (user && user.role === "admin") {
  const dealershipFabricators = await User.find({
    accountType: "FABRICATOR",
    dealership: { $ne: null },
  }).select("_id");

  query["user.userId"] = {
    $nin: dealershipFabricators.map((fabricator) => fabricator._id),
  };
}

    if (filters.orderType && filters.orderType === "ongoing") {
      query["isComplete"] = false;
    }

    if (filters.orderType && filters.orderType === "completed") {
      query["isComplete"] = true;
    }

    if (filters.search) {
      query["$or"] = [
        {
          "products.name": {
            $regex: escapeRegExp(filters.search),
            $options: "i",
          },
        },
        {
          "products.description": {
            $regex: escapeRegExp(filters.search),
            $options: "i",
          },
        },
      ];
    }

    if (filters.orderId) {
      query["_id"] = filters.orderId;
    }

    let project = {};

    if (req.query && req.query.needDocuments) {
    } else {
      project = {
        biltyDoc: 0,
        eWayBill: 0,
        taxInvoice: 0,
        "payments.proof": 0,
      };
    }


    const [orders, totalCount] = await Promise.all([
      UserOrder.find(query, project)
        .sort(sortObj)
        .skip(skip)
        .limit(limit),
      UserOrder.countDocuments(query),
    ]);

    if (!orders) {
      return res.status(404).json({ message: "No orders found" });
    }

    res.status(200).json({ orders, totalCount });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Error fetching orders" });
  }
};

const createPayment = async (req, res) => {
  const { orderId, amount, proof } = req.body;

  if (!orderId || !amount || !proof) {
    return res
      .status(400)
      .json({ message: "Please select order and add payment details." });
  }

  try {
    const order = await UserOrder.findOne({
      _id: orderId,
    });

    if (!order) {
      return res.status(400).json({
        message: "Order cannot be found.",
      });
    }

    if (order.isComplete) {
      return res.status(409).json({ message: "Order is already completed." });
    }

    const latestPayment = order.payments[order.payments.length - 1];

    order.payments.push({
      amount,
      proof,
      proofAdded: true,
      cycle: latestPayment.cycle + 1,
      isApproved: false,
    });
    order.updatedAt = new Date();

    const updatedOrder = await order.save();

    return res.status(200).json({
      message: "Payment approved successfully.",
      order: updatedOrder,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

const approvePayment = async (req, res) => {
  const { orderId, paymentId, finalPaymentDueDate, depositedAmount } = req.body;

  if (!orderId || !paymentId) {
    return res
      .status(400)
      .json({ message: "Please select order and payment." });
  }

  if (!depositedAmount || depositedAmount <= 0) {
    return res
      .status(400)
      .json({ message: "Please enter the deposited amount." });
  }

  try {
    // const order = await UserOrder.findOne({
    //   _id: orderId,
    //   "payments._id": paymentId,
    // });
    const orderQuery = {
  _id: orderId,
  "payments._id": paymentId,
};

if (req.user?.role !== "admin") {
  orderQuery.dealership = req.user.userId;
}

const order = await UserOrder.findOne(orderQuery);

    if (!order) {
      return res.status(400).json({
        message: "Order cannot be found.",
      });
    }

    const payment = order.payments.find(
      (el) => el._id.toString() === paymentId.toString()
    );

    if (!payment) {
      return res.status(400).json({
        message: "Payment cannot be found.",
      });
    }

    if (payment.cycle === 1 && !finalPaymentDueDate) {
      return res.status(400).json({
        message: "Final payment due date is required.",
      });
    }

    if (payment.cycle === 2 && payment.isApproved) {
      return res.status(400).json({
        message: "Final payment already approved. Complete Order instead.",
      });
    }

    order.payments = order.payments.map((el) =>
      el._id.toString() === paymentId.toString()
        ? { ...el, isApproved: true, depositedAmount: depositedAmount }
        : el
    );

    if (order.payments.length === 1) {
      order.payments.push({
        amount: order.payments[0].amount,
        cycle: 2,
        proofAdded: false,
        isApproved: false,
        dueDate: finalPaymentDueDate,
      });
    }

    order.updatedAt = new Date();

    const updatedOrder = await order.save();

    if (updatedOrder.isComplete) {
      return res.status(200).json({
        message: "Order completed successfully.",
        order: updatedOrder,
      });
    }

    return res.status(200).json({
      message: "Payment approved successfully.",
      order: updatedOrder,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

const updatePaymentDueDate = async (req, res) => {
  const { orderId, paymentId, dueDate } = req.body;

  if (!orderId || !paymentId || !dueDate) {
    return res
      .status(400)
      .json({ message: "Please select order, payment and due date." });
  }

  try {
    // const order = await UserOrder.findOne({
    //   _id: orderId,
    //   "payments._id": paymentId,
    // });
    const orderQuery = {
  _id: orderId,
  "payments._id": paymentId,
};

if (req.user?.role !== "admin") {
  orderQuery.dealership = req.user.userId;
}

const order = await UserOrder.findOne(orderQuery);

    if (!order) {
      return res.status(400).json({
        message: "Order cannot be found.",
      });
    }

    const payment = order.payments.find(
      (el) => el._id.toString() === paymentId.toString()
    );

    if (!payment) {
      return res.status(400).json({
        message: "Payment cannot be found.",
      });
    }

    if (payment.cycle !== 2) {
      return res.status(400).json({
        message: "Only final payment due date can be changed.",
      });
    }

    order.payments = order.payments.map((el) =>
      el._id.toString() === paymentId.toString() ? { ...el, dueDate } : el
    );

    order.updatedAt = new Date();

    const updatedOrder = await order.save();

    return res.status(200).json({
      message: "Due date updated successfully.",
      order: updatedOrder,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

const completeOrder = async (req, res) => {
  const { orderId, biltyDoc, eWayBill, driverInfo, taxInvoice } = req.body;

  if (!orderId || !biltyDoc || !eWayBill || !driverInfo || !taxInvoice) {
    return res
      .status(400)
      .json({ message: "Please add all required documents." });
  }

  try {
    // const order = await UserOrder.findOne({
    //   _id: orderId,
    // });
    const orderQuery = {
  _id: orderId,
};

if (req.user?.role !== "admin") {
  orderQuery.dealership = req.user.userId;
}

const order = await UserOrder.findOne(orderQuery);

    if (!order) {
      return res.status(400).json({
        message: "Order cannot be found.",
      });
    }

    if (order.isComplete) {
      return res.status(409).json({ message: "Order is already completed." });
    }

    order.biltyDoc = biltyDoc;
    order.eWayBill = eWayBill;
    order.driverInfo = {
      name: driverInfo.name,
      phone: driverInfo.phone,
    };
    order.taxInvoice = taxInvoice;
    order.isComplete = true;
    order.completedAt = new Date();
    order.updatedAt = new Date();

    if (order.inventoryDisposition === "ADD_TO_DEALER_STOCK" && !order.inventoryProcessedAt) {
      await addStock(order.dealership || order.user.userId, order.products, order._id);
      order.inventoryProcessedAt = new Date();
    }

    const updatedOrder = await order.save();

    return res.status(200).json({
      message: "Order completed successfully.",
      order: updatedOrder,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

const updateNalco = async (req, res) => {
  const nalcoPrice = Number(req.body.nalcoPrice);

  if (!Number.isFinite(nalcoPrice) || nalcoPrice <= 0) {
    return res.status(400).json({ message: "Please enter price" });
  }

  try {
    const nalco = await Nalco.findOne({}).sort({ date: -1 });

    if (!nalco) {
      const newNalco = new Nalco({
        nalcoPrice,
        date: new Date(),
      });

      const savedNalco = await newNalco.save();

      return res.status(201).json({
        message: "Nalco created successfully.",
        nalco: savedNalco,
      });
    } else {
      if (nalco.nalcoPrice === nalcoPrice) {
        return res.status(200).json({
          message: "Nalco price unchanged.",
          nalco,
          notification: { sent: false, reason: "unchanged" },
        });
      }

      const previousPrice = nalco.nalcoPrice;
      const updatedNalco = await Nalco.create({
        nalcoPrice,
        date: new Date(),
      });
      let notification;
      try {
        notification = {
          sent: true,
          direction: nalcoPrice > previousPrice ? "increase" : "decrease",
          ...(await sendNalcoMessageToUsers(nalcoPrice)),
        };
      } catch (notificationError) {
        console.error("Failed to send Nalco WhatsApp update:", notificationError);
        notification = {
          sent: false,
          direction: nalcoPrice > previousPrice ? "increase" : "decrease",
          error: notificationError.message,
        };
      }

      return res.status(200).json({
        message: "Nalco updated successfully.",
        nalco: updatedNalco,
        notification,
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "glazia.in@gmail.com",
    pass: "Glazia@2025!@",
    // pass: 'qmatmebtwyepcmky',
  },
});

const sendEmail = async (req, res) => {
  const { to, subject, text, pdf } = req.body;
  console.log("received");
  const pdfBuffer = Buffer.from(pdf, "base64");

  const mailOptions = {
    from: "glazia.in@gmail.com",
    to,
    subject,
    text,
    attachments: [
      {
        filename: "Glazia Performa Invoice.pdf",
        content: pdfBuffer,
        encoding: "base64",
      },
    ],
  };
  res.send("Email sent successfully");
  transporter.sendMail(mailOptions, (error, info) => {
    console.log(error);
    if (error) {
      return res.status(500).send("Error sending email");
    }
  });
};

const uploadPaymentProof = async (req, res) => {
  const { orderId, paymentId, proof } = req.body;

  console.log("uploading payment proof", orderId, paymentId);

  if (!orderId || !paymentId || !proof) {
    return res
      .status(400)
      .json({ message: "Please select order and payment." });
  }

  try {
    const order = await UserOrder.findOne({
      _id: orderId,
    });

    if (!order) {
      return res.status(400).json({
        message: "Order cannot be found.",
      });
    }

    const payment = order.payments.find(
      (el) => el._id.toString() === paymentId.toString()
    );

    if (!payment) {
      return res.status(400).json({
        message: "Payment cannot be found.",
      });
    }

    payment.proof = proof;
    payment.proofAdded = true;
    payment.isApproved = false;
    payment.proofAddedAt = new Date();

    const updatedOrder = await order.save();

    return res.status(200).json({
      message: "Payment proof uploaded successfully.",
      order: updatedOrder,
    });
  } catch (error) {
    console.error(error);
  }
};

module.exports = {
  createOrder,
  getOrders,
  createPayment,
  approvePayment,
  updatePaymentDueDate,
  completeOrder,
  updateNalco,
  sendEmail,
  uploadPaymentProof,
};
