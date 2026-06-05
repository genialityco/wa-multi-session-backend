import mongoose from 'mongoose';

const confirmationSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
  },
  meetingId: {
    type: String,
    required: true,
  },
  confirmed: {
    type: Boolean,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

export default mongoose.model('Confirmation', confirmationSchema);
