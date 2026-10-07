const mongoose = require('mongoose');
const dns = require('node:dns');
require('dotenv').config();

const dbURI = process.env.MONGO_URI || 'mongodb+srv://glaziain:Glazia%40123@glazia.elx92.mongodb.net/?retryWrites=true&w=majority&appName=glazia';

const connectDB = async () => {
  try {
    try {
      await mongoose.connect(dbURI);
    } catch (error) {
      const localEnvironment = !process.env.NODE_ENV || ['development', 'test'].includes(process.env.NODE_ENV);
      const dnsFailure = ['querySrv', 'queryTxt'].includes(error.syscall) &&
        ['ECONNREFUSED', 'ETIMEOUT', 'ESERVFAIL'].includes(error.code);
      if (!localEnvironment || !dnsFailure || !dbURI.startsWith('mongodb+srv://')) throw error;
      // Node can use a broken loopback resolver even when Windows DNS works.
      // Change only this local process, never the machine or production settings.
      const servers = (process.env.LOCAL_MONGO_DNS_SERVERS || '1.1.1.1,8.8.8.8')
        .split(',').map(server => server.trim()).filter(Boolean);
      dns.setServers(servers);
      console.warn('Local MongoDB DNS lookup failed; retrying with alternate DNS servers.');
      await mongoose.connect(dbURI);
    }
    console.log('MongoDB connected');
} catch (err) {
    console.error('Database connection error:', err);
    process.exit(1); // Exit the application if the connection fails
  }
};

module.exports = connectDB;
