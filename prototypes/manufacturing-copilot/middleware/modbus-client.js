'use strict';

const net = require('net');

class ModbusClient {
  constructor(host = '127.0.0.1', port = 5020) {
    this.host = host;
    this.port = port;
    this.transactionId = 0;
  }

  async sendCmd(payload) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Modbus TCP connection timeout'));
      }, 1000);

      socket.connect(this.port, this.host, () => {
        socket.write(payload);
      });

      socket.on('data', (data) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(data);
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      });
    });
  }

  async readCoils(address, quantity) {
    this.transactionId++;
    const payload = Buffer.alloc(12);
    payload.writeUInt16BE(this.transactionId, 0); // Transaction ID
    payload.writeUInt16BE(0, 2);                  // Protocol ID
    payload.writeUInt16BE(6, 4);                  // Remaining Length
    payload[6] = 1;                               // Unit ID
    payload[7] = 1;                               // FC: Read Coils
    payload.writeUInt16BE(address, 8);
    payload.writeUInt16BE(quantity, 10);

    const res = await this.sendCmd(payload);
    if (res.length < 9) throw new Error('Short Modbus TCP response');
    const fc = res[7];
    if (fc & 0x80) throw new Error(`Modbus TCP Exception: ${res[8]}`);

    const byteCount = res[8];
    const coils = [];
    for (let i = 0; i < quantity; i++) {
      const byteIndex = 9 + Math.floor(i / 8);
      const bitIndex = i % 8;
      const val = (res[byteIndex] >> bitIndex) & 1;
      coils.push(val);
    }
    return coils;
  }

  async readHoldingRegisters(address, quantity) {
    this.transactionId++;
    const payload = Buffer.alloc(12);
    payload.writeUInt16BE(this.transactionId, 0);
    payload.writeUInt16BE(0, 2);
    payload.writeUInt16BE(6, 4);
    payload[6] = 1;
    payload[7] = 3; // FC: Read Holding Registers
    payload.writeUInt16BE(address, 8);
    payload.writeUInt16BE(quantity, 10);

    const res = await this.sendCmd(payload);
    if (res.length < 9) throw new Error('Short Modbus TCP response');
    const fc = res[7];
    if (fc & 0x80) throw new Error(`Modbus TCP Exception: ${res[8]}`);

    const registers = [];
    for (let i = 0; i < quantity; i++) {
      registers.push(res.readUInt16BE(9 + (i * 2)));
    }
    return registers;
  }

  async writeSingleCoil(address, value) {
    this.transactionId++;
    const payload = Buffer.alloc(12);
    payload.writeUInt16BE(this.transactionId, 0);
    payload.writeUInt16BE(0, 2);
    payload.writeUInt16BE(6, 4);
    payload[6] = 1;
    payload[7] = 5; // FC: Write Single Coil
    payload.writeUInt16BE(address, 8);
    payload.writeUInt16BE(value ? 0xFF00 : 0x0000, 10);

    const res = await this.sendCmd(payload);
    if (res.length < 12) throw new Error('Short Modbus TCP response');
    const fc = res[7];
    if (fc & 0x80) throw new Error(`Modbus TCP Exception: ${res[8]}`);
    return res.readUInt16BE(10) === 0xFF00;
  }

  async writeSingleRegister(address, value) {
    this.transactionId++;
    const payload = Buffer.alloc(12);
    payload.writeUInt16BE(this.transactionId, 0);
    payload.writeUInt16BE(0, 2);
    payload.writeUInt16BE(6, 4);
    payload[6] = 1;
    payload[7] = 6; // FC: Write Single Register
    payload.writeUInt16BE(address, 8);
    payload.writeUInt16BE(value, 10);

    const res = await this.sendCmd(payload);
    if (res.length < 12) throw new Error('Short Modbus TCP response');
    const fc = res[7];
    if (fc & 0x80) throw new Error(`Modbus TCP Exception: ${res[8]}`);
    return res.readUInt16BE(10);
  }
}

// Direct utility functions for compatibility with graph.js
async function writeSingleRegister(address, value, port = 5020, host = '127.0.0.1') {
  const client = new ModbusClient(host, port);
  return client.writeSingleRegister(address, value);
}

async function readHoldingRegisters(address, count, port = 5020, host = '127.0.0.1') {
  const client = new ModbusClient(host, port);
  return client.readHoldingRegisters(address, count);
}

async function writeSingleCoil(address, value, port = 5020, host = '127.0.0.1') {
  const client = new ModbusClient(host, port);
  return client.writeSingleCoil(address, value);
}

async function readCoils(address, count, port = 5020, host = '127.0.0.1') {
  const client = new ModbusClient(host, port);
  return client.readCoils(address, count);
}

module.exports = ModbusClient;
module.exports.writeSingleRegister = writeSingleRegister;
module.exports.readHoldingRegisters = readHoldingRegisters;
module.exports.writeSingleCoil = writeSingleCoil;
module.exports.readCoils = readCoils;
