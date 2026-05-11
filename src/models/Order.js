const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", counterSchema);

// Define the user schema
const userSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
  city: { type: String, required: true },
  phoneNumber: { type: String, required: true },
});

// Define the order schema
const orderSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  description: { type: String, required: false },
  quantity: { type: Number, required: true },
  amount: { type: Number, required: true },
});

// Define the payment shema
const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  cycle: { type: Number, required: true },
  proof: { type: String, required: false },
  proofAdded: { type: Boolean, required: false },
  proofAddedAt: { type: Date, required: false },
  isApproved: { type: Boolean, default: false },
  dueDate: { type: Date },
  depositedAmount: { type: Number, required: false }, // Amount deposited by user as entered by admin during approval
});

// Define the user order schema
const userOrderSchema = new mongoose.Schema(
  {
    orderId: { type: Number, unique: true, index: true },
    user: { type: userSchema, required: true },
    products: { type: [orderSchema], required: true },
    payments: [{ type: paymentSchema }],
    totalAmount: { type: Number, required: false },
    biltyDoc: { type: String },
    eWayBill: { type: String },
    driverInfo: {
      name: { type: String },
      phone: { type: String },
      description: { type: String },
    },
    taxInvoice: { type: String },
    isComplete: { type: Boolean, default: false },
    completedAt: { type: Date },
    deliveryType: {
      type: String,
      enum: ['SELF', 'FULL', 'PART'],
      required: true,
    },
  },
  { timestamps: true }
);

userOrderSchema.pre("save", async function (next) {
  if (!this.isNew || this.orderId) {
    return next();
  }

  try {
    const counter = await Counter.findOneAndUpdate(
      { name: "userOrder" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    this.orderId = counter.seq;
    return next();
  } catch (error) {
    return next(error);
  }
});

const nalcoSchema = new mongoose.Schema({
  nalcoPrice: { type: Number, required: true },
  date: { type: Date, required: true },
});

const UserOrder = mongoose.model("UserOrder", userOrderSchema);
const Nalco = mongoose.model("nalco", nalcoSchema);

module.exports = { UserOrder, Nalco };
