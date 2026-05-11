const mongoose = require('mongoose');

const techSheetSchema = new mongoose.Schema({
    main: { type: String, required: true },
    category: { type: String, required: true},
    subCategory: { type: String, required: true},
    shutterHeight: { type: Number, required: true },
    shutterWidth: { type: Number, required: true },
    lockingMechanism: { type: String, required: true },
    glassSize: { type: String, required: true },
    alloy: { type: String, required: true },
    interlock: { type: Number, required: true },
});

const TechnicalSheet = mongoose.model('techSheetSchema', techSheetSchema);

module.exports = TechnicalSheet;