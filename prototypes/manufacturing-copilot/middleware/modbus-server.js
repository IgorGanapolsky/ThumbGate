'use strict';

const net = require('node:net');

// Coils (0-3)
// 0: Plant Shutdown Command (1 = Tripped, 0 = Normal)
// 1: Conveyor C-3 Stop Command (1 = Stopped, 0 = Normal)
// 2: Interlock Override Command (1 = Bypassed, 0 = Normal)
// 3: Furnace E-Stop Command (1 = Tripped, 0 = Normal)
const coils = new Uint8Array(4);

// Holding Registers (0-3)
// Index 0: Conveyor State (0 = Stop, 1 = Run)
// Index 1: Safety Curtain State (0 = Disabled, 1 = Armed)
// Index 2: Main Power System (0 = Off, 1 = On)
// Index 3: Furnace Temperature (in Celsius)
const registers = new Uint16Array(4);

function resetState() {
  coils[0] = 0;
  coils[1] = 0;
  coils[2] = 0;
  coils[3] = 0;

  registers[0] = 1; // Conveyor Running
  registers[1] = 1; // Safety Curtain Armed
  registers[2] = 1; // Main Power On
  registers[3] = 220; // Furnace at 220C
}

// Initialize state
resetState();

function updatePhysics() {
  // If Plant Shutdown is commanded (Coil 0 = 1) or Main Power is written to 0
  if (coils[0] === 1 || registers[2] === 0) {
    coils[0] = 1;
    registers[2] = 0; // Main Power Off
    registers[0] = 0; // Conveyor Stopped
    registers[1] = 0; // Safety Curtain Disabled
    registers[3] = 25; // Cooled down to room temp
    coils[1] = 1;
    coils[2] = 1;
    coils[3] = 1;
    return;
  }

  // Conveyor Stop (Coil 1 = 1 or Register 0 = 0)
  if (coils[1] === 1 || registers[0] === 0) {
    coils[1] = 1;
    registers[0] = 0;
  } else {
    coils[1] = 0;
    registers[0] = 1;
  }

  // Interlock Override / Safety Curtain (Coil 2 = 1 or Register 1 = 0)
  if (coils[2] === 1 || registers[1] === 0) {
    coils[2] = 1;
    registers[1] = 0;
  } else {
    coils[2] = 0;
    registers[1] = 1;
  }

  // Furnace E-Stop (Coil 3 = 1)
  if (coils[3] === 1) {
    registers[3] = 25;
  } else {
    // If not stopped, keep furnace heated (registers[3] is whatever it's set to, default 220)
    if (registers[3] === 25) {
      registers[3] = 220;
    }
  }
}

let server = null;
let activeConnections = new Set();

function startModbusServer(port = 5020) {
  if (server) return Promise.resolve(server);

  server = net.createServer((socket) => {
    activeConnections.add(socket);

    socket.on('data', (data) => {
      if (data.length < 12) return; // Modbus TCP packet must be at least 12 bytes

      const transactionId = data.readUInt16BE(0);
      const protocolId = data.readUInt16BE(2);
      const length = data.readUInt16BE(4);
      const unitId = data.readUInt8(6);
      const functionCode = data.readUInt8(7);
      const startAddress = data.readUInt16BE(8);
      const valueOrQuantity = data.readUInt16BE(10);

      if (protocolId !== 0) return;

      if (functionCode === 0x01) {
        // Read Coils
        const quantity = valueOrQuantity;
        const byteCount = Math.ceil(quantity / 8);
        const response = Buffer.alloc(9 + byteCount);

        response.writeUInt16BE(transactionId, 0);
        response.writeUInt16BE(0, 2);
        response.writeUInt16BE(3 + byteCount, 4);
        response.writeUInt8(unitId, 6);
        response.writeUInt8(functionCode, 7);
        response.writeUInt8(byteCount, 8);

        let byteVal = 0;
        for (let i = 0; i < quantity; i++) {
          const addr = startAddress + i;
          const val = coils[addr] ?? 0;
          if (val) {
            byteVal |= (1 << (i % 8));
          }
          if ((i % 8 === 7) || (i === quantity - 1)) {
            response[9 + Math.floor(i / 8)] = byteVal;
            byteVal = 0;
          }
        }
        socket.write(response);

      } else if (functionCode === 0x03) {
        // Read Holding Registers
        const quantity = valueOrQuantity;
        const byteCount = quantity * 2;
        const response = Buffer.alloc(9 + byteCount);

        response.writeUInt16BE(transactionId, 0);
        response.writeUInt16BE(0, 2);
        response.writeUInt16BE(3 + byteCount, 4);
        response.writeUInt8(unitId, 6);
        response.writeUInt8(functionCode, 7);
        response.writeUInt8(byteCount, 8);

        for (let i = 0; i < quantity; i++) {
          const regIndex = startAddress + i;
          const val = registers[regIndex] ?? 0;
          response.writeUInt16BE(val, 9 + i * 2);
        }

        socket.write(response);

      } else if (functionCode === 0x05) {
        // Write Single Coil
        const coilIndex = startAddress;
        if (coilIndex >= 0 && coilIndex < coils.length) {
          coils[coilIndex] = valueOrQuantity === 0xFF00 ? 1 : 0;
        }
        updatePhysics();

        const response = Buffer.alloc(12);
        data.copy(response);
        socket.write(response);

      } else if (functionCode === 0x06) {
        // Write Single Register
        const regIndex = startAddress;
        if (regIndex >= 0 && regIndex < registers.length) {
          registers[regIndex] = valueOrQuantity;
        }
        updatePhysics();

        const response = Buffer.alloc(12);
        data.copy(response);
        socket.write(response);
      }
    });

    socket.on('error', () => {
      activeConnections.delete(socket);
    });

    socket.on('close', () => {
      activeConnections.delete(socket);
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[ModbusServer] Real Modbus TCP PLC listening on 127.0.0.1:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

function stopModbusServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    for (const socket of activeConnections) {
      socket.destroy();
    }
    activeConnections.clear();
    server.close(() => {
      console.log('[ModbusServer] Modbus TCP server stopped.');
      server = null;
      resolve();
    });
  });
}

function getRegistersState() {
  return {
    conveyorState: registers[0],
    safetyCurtainState: registers[1],
    mainPowerSystem: registers[2],
    furnaceTemperature: registers[3],
    coils: {
      0: coils[0],
      1: coils[1],
      2: coils[2],
      3: coils[3]
    }
  };
}

module.exports = {
  startModbusServer,
  stopModbusServer,
  getRegistersState,
  resetState,
  registers,
  coils
};
