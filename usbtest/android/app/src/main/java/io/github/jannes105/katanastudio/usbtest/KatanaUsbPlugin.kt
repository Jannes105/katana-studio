package io.github.jannes105.katanastudio.usbtest

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * Raw USB access to the BOSS Katana Gen 3 (vendor-specific device, not USB-MIDI class).
 * The plugin only moves bytes. Packing SysEx into USB-MIDI packets happens in JavaScript.
 *
 * Threads:
 *  - plugin methods arrive on Capacitor's bridge thread and return at once
 *  - open/close/send run on [io] (one thread, so they never overlap)
 *  - IN transfers run on their own read thread
 *  - broadcasts (permission answer, detach) arrive on the main thread
 * Everything that describes the open connection is guarded by [lock].
 */
@CapacitorPlugin(name = "KatanaUsb")
class KatanaUsbPlugin : Plugin() {

    companion object {
        private const val TAG = "KatanaUsb"
        private const val ACTION_USB_PERMISSION = "io.github.jannes105.katanastudio.usbtest.USB_PERMISSION"
        private const val KATANA_VENDOR_ID = 0x0582
        private const val KATANA_PRODUCT_ID = 0x02F0
        private const val READ_TIMEOUT_MS = 100
        private const val WRITE_TIMEOUT_MS = 1000
    }

    private lateinit var usbManager: UsbManager
    private val io: ExecutorService = Executors.newSingleThreadExecutor()

    private val lock = Any()
    private var connection: UsbDeviceConnection? = null
    private var openDevice: UsbDevice? = null
    private var claimedInterface: UsbInterface? = null
    private var outEndpoint: UsbEndpoint? = null
    private var readThread: Thread? = null
    private var pendingOpen: PluginCall? = null

    @Volatile
    private var reading = false
    private var receiverRegistered = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            try {
                when (intent.action) {
                    ACTION_USB_PERMISSION -> onPermissionResult(intent)
                    UsbManager.ACTION_USB_DEVICE_DETACHED -> onDetached(intent)
                }
            } catch (e: Exception) {
                emitError("Broadcast handling failed: $e")
            }
        }
    }

    // ---------------------------------------------------------------- lifecycle

    override fun load() {
        usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        val filter = IntentFilter()
        filter.addAction(ACTION_USB_PERMISSION)
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        // NOT_EXPORTED still lets broadcasts from the system through (detach, and the permission
        // answer, which the system sends for our own PendingIntent). Other apps are kept out.
        // ContextCompat picks the right call for API 33+ and below.
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        receiverRegistered = true
        log("Plugin loaded (Android API ${Build.VERSION.SDK_INT}), receiver registered")
        // Cold start by plugging in: the attach intent is the launch intent, onNewIntent never fires.
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    override fun handleOnNewIntent(intent: Intent) {
        try {
            if (intent.action != UsbManager.ACTION_USB_DEVICE_ATTACHED) return
            val device = deviceFromIntent(intent)
            if (device == null) {
                log("USB_DEVICE_ATTACHED intent without a device")
                return
            }
            log("Attached: ${shortName(device)}, permission=${usbManager.hasPermission(device)}")
            val data = JSObject()
            data.put("device", describeDevice(device))
            emit("attached", data, true)
        } catch (e: Exception) {
            emitError("Handling the attach intent failed: $e")
        }
    }

    override fun handleOnDestroy() {
        if (receiverRegistered) {
            try {
                context.unregisterReceiver(receiver)
            } catch (e: Exception) {
                Log.w(TAG, "unregisterReceiver failed", e)
            }
            receiverRegistered = false
        }
        closeInternal("activity destroyed")
        io.shutdown()
    }

    // ---------------------------------------------------------------- plugin methods

    @PluginMethod
    fun listDevices(call: PluginCall) {
        try {
            val devices = JSArray()
            for (device in usbManager.deviceList.values) {
                devices.put(describeDevice(device))
            }
            val result = JSObject()
            result.put("devices", devices)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("listDevices failed: $e")
        }
    }

    @PluginMethod
    fun open(call: PluginCall) {
        try {
            val device = findDevice(call.getInt("vendorId"), call.getInt("productId"))
            if (device == null) {
                call.reject("No matching USB device attached (${usbManager.deviceList.size} device(s) visible)")
                return
            }
            if (usbManager.hasPermission(device)) {
                log("Permission already granted for ${shortName(device)}")
                runOpen(call, device)
                return
            }
            val older = synchronized(lock) {
                val previous = pendingOpen
                pendingOpen = call
                previous
            }
            older?.reject("Replaced by a newer open() call")
            log("Asking for USB permission for ${shortName(device)}")
            // Explicit (setPackage) and mutable: the system adds the device and the answer as extras.
            val intent = Intent(ACTION_USB_PERMISSION).setPackage(context.packageName)
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags = flags or PendingIntent.FLAG_MUTABLE
            }
            usbManager.requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, flags))
        } catch (e: Exception) {
            synchronized(lock) {
                if (pendingOpen === call) pendingOpen = null
            }
            call.reject("open failed: $e")
        }
    }

    @PluginMethod
    fun close(call: PluginCall) {
        try {
            io.execute {
                closeInternal("close() called")
                call.resolve(JSObject())
            }
        } catch (e: Exception) {
            call.reject("close failed: $e")
        }
    }

    @PluginMethod
    fun send(call: PluginCall) {
        try {
            val array = call.getArray("bytes")
            if (array == null) {
                call.reject("send needs { bytes: number[] }")
                return
            }
            val bytes = ByteArray(array.length())
            for (i in bytes.indices) {
                bytes[i] = (array.getInt(i) and 0xFF).toByte()
            }
            io.execute {
                try {
                    var conn: UsbDeviceConnection? = null
                    var ep: UsbEndpoint? = null
                    synchronized(lock) {
                        conn = connection
                        ep = outEndpoint
                    }
                    val c = conn
                    val e = ep
                    if (c == null || e == null) {
                        call.reject("Not open")
                    } else {
                        // bulkTransfer also serves interrupt endpoints.
                        val written = c.bulkTransfer(e, bytes, bytes.size, WRITE_TIMEOUT_MS)
                        if (written < 0) {
                            call.reject("Send failed: bulkTransfer returned $written for ${bytes.size} byte(s)")
                        } else {
                            val result = JSObject()
                            result.put("written", written)
                            call.resolve(result)
                        }
                    }
                } catch (ex: Exception) {
                    call.reject("send failed: $ex")
                }
            }
        } catch (e: Exception) {
            call.reject("send failed: $e")
        }
    }

    // ---------------------------------------------------------------- broadcasts

    private fun onPermissionResult(intent: Intent) {
        val device = deviceFromIntent(intent)
        val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
        val call = synchronized(lock) {
            val pending = pendingOpen
            pendingOpen = null
            pending
        }
        if (granted && device != null) {
            log("USB permission granted for ${shortName(device)}")
            if (call != null) runOpen(call, device)
        } else {
            log("USB permission denied" + if (device == null) " (no device in the answer)" else "")
            call?.reject("USB permission denied")
        }
    }

    private fun onDetached(intent: Intent) {
        val device = deviceFromIntent(intent)
        log("Detached: " + if (device != null) shortName(device) else "unknown device")
        val wasOurs = synchronized(lock) {
            val current = openDevice
            current != null && (device == null || device.deviceName == current.deviceName)
        }
        if (wasOurs) closeInternal("device detached")
        emit("detached", JSObject(), false)
    }

    // ---------------------------------------------------------------- open / close

    private fun runOpen(call: PluginCall, device: UsbDevice) {
        try {
            io.execute {
                try {
                    doOpen(call, device)
                } catch (e: Exception) {
                    emitError("open failed: $e")
                    call.reject("open failed: $e")
                }
            }
        } catch (e: Exception) {
            call.reject("open failed: $e")
        }
    }

    private fun doOpen(call: PluginCall, device: UsbDevice) {
        closeInternal("re-open")

        val wantedIn = call.getInt("inEndpoint")
        val wantedOut = call.getInt("outEndpoint")
        val intf = pickInterface(device, call.getInt("interfaceId"), call.getInt("alternateSetting"), wantedIn, wantedOut)
        if (intf == null) {
            call.reject("No usable interface: need one alternate setting with an IN and an OUT endpoint (bulk or interrupt) and no isochronous endpoint")
            return
        }
        val inEp = pickEndpoint(intf, UsbConstants.USB_DIR_IN, wantedIn)
        val outEp = pickEndpoint(intf, UsbConstants.USB_DIR_OUT, wantedOut)
        if (inEp == null || outEp == null) {
            call.reject("Interface ${intf.id} alt ${intf.alternateSetting} lacks the requested IN/OUT endpoint")
            return
        }
        log(
            "Chosen: interface ${intf.id} alt ${intf.alternateSetting} class 0x${hex(intf.interfaceClass)}, " +
                "IN 0x${hex(inEp.address)} (${typeName(inEp.type)}, ${inEp.maxPacketSize} bytes), " +
                "OUT 0x${hex(outEp.address)} (${typeName(outEp.type)}, ${outEp.maxPacketSize} bytes)"
        )

        val conn = usbManager.openDevice(device)
        if (conn == null) {
            call.reject("openDevice returned null")
            return
        }
        log("Device opened")

        // force = true takes the interface away from a kernel driver (e.g. snd-usb-audio).
        val claimed = conn.claimInterface(intf, true)
        log("claimInterface(force) -> $claimed")
        if (!claimed) {
            conn.close()
            call.reject("claimInterface failed for interface ${intf.id}")
            return
        }
        val altOk = conn.setInterface(intf)
        log("setInterface(alt ${intf.alternateSetting}) -> $altOk")
        if (!altOk) {
            // Not fatal: some devices refuse the request for alternate setting 0 although it is active.
            emitError("setInterface failed for alt ${intf.alternateSetting}, trying to continue")
        }

        val raw = JSArray()
        try {
            val descriptors = conn.rawDescriptors
            if (descriptors != null) {
                for (b in descriptors) raw.put(b.toInt() and 0xFF)
            }
        } catch (e: Exception) {
            log("rawDescriptors failed: $e")
        }

        synchronized(lock) {
            connection = conn
            openDevice = device
            claimedInterface = intf
            outEndpoint = outEp
            reading = true
            val thread = Thread({ readLoop(conn, inEp) }, "KatanaUsbRead")
            readThread = thread
            thread.start()
        }

        val result = JSObject()
        result.put("interfaceId", intf.id)
        result.put("alternateSetting", intf.alternateSetting)
        result.put("inEndpoint", describeEndpoint(inEp))
        result.put("outEndpoint", describeEndpoint(outEp))
        result.put("rawDescriptors", raw)
        result.put("setInterfaceOk", altOk)
        call.resolve(result)
    }

    /** Stops the read thread, releases the interface and closes the connection. Safe to call twice. */
    private fun closeInternal(reason: String) {
        var conn: UsbDeviceConnection? = null
        var intf: UsbInterface? = null
        var thread: Thread? = null
        synchronized(lock) {
            conn = connection
            intf = claimedInterface
            thread = readThread
            connection = null
            openDevice = null
            claimedInterface = null
            outEndpoint = null
            readThread = null
            reading = false
        }
        val c = conn ?: return
        log("Closing ($reason)")
        try {
            val t = thread
            if (t != null && t !== Thread.currentThread()) t.join(500)
        } catch (e: Exception) {
            Log.w(TAG, "join failed", e)
        }
        try {
            val i = intf
            if (i != null) log("releaseInterface -> ${c.releaseInterface(i)}")
        } catch (e: Exception) {
            log("releaseInterface failed: $e")
        }
        try {
            c.close()
        } catch (e: Exception) {
            log("close failed: $e")
        }
        log("Closed")
    }

    private fun readLoop(conn: UsbDeviceConnection, ep: UsbEndpoint) {
        // Buffer: a multiple of maxPacketSize, at least 8 packets and at least 512 bytes.
        val packet = maxOf(ep.maxPacketSize, 1)
        val buffer = ByteArray(packet * maxOf(8, (511 + packet) / packet))
        log("Read thread started (buffer ${buffer.size} bytes, timeout $READ_TIMEOUT_MS ms)")
        var quickFailures = 0
        try {
            while (reading) {
                val started = SystemClock.elapsedRealtime()
                val n = conn.bulkTransfer(ep, buffer, buffer.size, READ_TIMEOUT_MS)
                if (n > 0) {
                    quickFailures = 0
                    val bytes = JSArray()
                    for (i in 0 until n) bytes.put(buffer[i].toInt() and 0xFF)
                    val data = JSObject()
                    data.put("bytes", bytes)
                    emit("data", data, false)
                } else if (n < 0 && reading) {
                    // -1 after the full timeout is normal (nothing to read). -1 that comes back
                    // at once means the transfer itself fails, e.g. the device is gone.
                    if (SystemClock.elapsedRealtime() - started < READ_TIMEOUT_MS / 2) {
                        quickFailures++
                        if (quickFailures == 50) {
                            emitError("IN transfers keep failing immediately (device gone or wrong endpoint?)")
                        }
                        Thread.sleep(20)
                    } else {
                        quickFailures = 0
                    }
                }
            }
        } catch (e: InterruptedException) {
            // asked to stop
        } catch (e: Exception) {
            if (reading) emitError("Read thread crashed: $e")
        }
        log("Read thread stopped")
    }

    // ---------------------------------------------------------------- choosing device, interface, endpoints

    private fun findDevice(vendorId: Int?, productId: Int?): UsbDevice? {
        val devices = usbManager.deviceList.values.toList()
        if (vendorId != null || productId != null) {
            return devices.firstOrNull {
                (vendorId == null || it.vendorId == vendorId) && (productId == null || it.productId == productId)
            }
        }
        val katana = devices.firstOrNull { it.vendorId == KATANA_VENDOR_ID && it.productId == KATANA_PRODUCT_ID }
        if (katana != null) return katana
        return if (devices.size == 1) devices[0] else null
    }

    private fun isBulkOrInterrupt(ep: UsbEndpoint): Boolean =
        ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK || ep.type == UsbConstants.USB_ENDPOINT_XFER_INT

    private fun endpoints(intf: UsbInterface): List<UsbEndpoint> =
        (0 until intf.endpointCount).map { intf.getEndpoint(it) }

    /** The endpoint with the given address, or the first bulk (else interrupt) endpoint in that direction. */
    private fun pickEndpoint(intf: UsbInterface, direction: Int, address: Int?): UsbEndpoint? {
        val candidates = endpoints(intf).filter { it.direction == direction && isBulkOrInterrupt(it) }
        if (address != null) return candidates.firstOrNull { it.address == address }
        return candidates.firstOrNull { it.type == UsbConstants.USB_ENDPOINT_XFER_BULK } ?: candidates.firstOrNull()
    }

    /**
     * Every alternate setting is its own UsbInterface object. Usable is one that has an IN and an
     * OUT endpoint (bulk or interrupt) and no isochronous endpoint (audio stays untouched).
     * Vendor-specific (class 0xFF) wins, otherwise the first one in descriptor order.
     */
    private fun pickInterface(device: UsbDevice, interfaceId: Int?, alternateSetting: Int?, inAddress: Int?, outAddress: Int?): UsbInterface? {
        val usable = ArrayList<UsbInterface>()
        for (i in 0 until device.interfaceCount) {
            val intf = device.getInterface(i)
            if (interfaceId != null && intf.id != interfaceId) continue
            if (alternateSetting != null && intf.alternateSetting != alternateSetting) continue
            val eps = endpoints(intf)
            val isochronous = eps.any { it.type == UsbConstants.USB_ENDPOINT_XFER_ISOC }
            val complete = pickEndpoint(intf, UsbConstants.USB_DIR_IN, inAddress) != null &&
                pickEndpoint(intf, UsbConstants.USB_DIR_OUT, outAddress) != null
            log(
                "Candidate: interface ${intf.id} alt ${intf.alternateSetting} class 0x${hex(intf.interfaceClass)}, " +
                    "${eps.size} endpoint(s), isochronous=$isochronous, usable=${complete && !isochronous}"
            )
            if (complete && !isochronous) usable.add(intf)
        }
        return usable.firstOrNull { it.interfaceClass == UsbConstants.USB_CLASS_VENDOR_SPEC } ?: usable.firstOrNull()
    }

    // ---------------------------------------------------------------- describing things for JavaScript

    private fun describeDevice(device: UsbDevice): JSObject {
        val o = JSObject()
        o.put("deviceName", device.deviceName)
        o.put("vendorId", device.vendorId)
        o.put("productId", device.productId)
        o.put("deviceClass", device.deviceClass)
        o.put("deviceSubclass", device.deviceSubclass)
        o.put("deviceProtocol", device.deviceProtocol)
        o.put("manufacturerName", orNull(safeString { device.manufacturerName }))
        o.put("productName", orNull(safeString { device.productName }))
        var permitted = false
        try {
            permitted = usbManager.hasPermission(device)
        } catch (e: Exception) {
            Log.w(TAG, "hasPermission failed", e)
        }
        o.put("hasPermission", permitted)
        val interfaces = JSArray()
        for (i in 0 until device.interfaceCount) {
            val intf = device.getInterface(i)
            val item = JSObject()
            item.put("id", intf.id)
            item.put("alternateSetting", intf.alternateSetting)
            item.put("interfaceClass", intf.interfaceClass)
            item.put("interfaceSubclass", intf.interfaceSubclass)
            item.put("interfaceProtocol", intf.interfaceProtocol)
            item.put("name", orNull(safeString { intf.name }))
            val eps = JSArray()
            for (ep in endpoints(intf)) eps.put(describeEndpoint(ep))
            item.put("endpoints", eps)
            interfaces.put(item)
        }
        o.put("interfaces", interfaces)
        return o
    }

    private fun describeEndpoint(ep: UsbEndpoint): JSObject {
        val o = JSObject()
        o.put("address", ep.address)
        o.put("number", ep.endpointNumber)
        o.put("direction", if (ep.direction == UsbConstants.USB_DIR_IN) "in" else "out")
        o.put("type", typeName(ep.type))
        o.put("maxPacketSize", ep.maxPacketSize)
        o.put("interval", ep.interval)
        return o
    }

    private fun typeName(type: Int): String = when (type) {
        UsbConstants.USB_ENDPOINT_XFER_BULK -> "bulk"
        UsbConstants.USB_ENDPOINT_XFER_INT -> "interrupt"
        UsbConstants.USB_ENDPOINT_XFER_ISOC -> "isochronous"
        else -> "control"
    }

    /** Device strings throw SecurityException without permission on some Android versions. */
    private fun safeString(read: () -> String?): String? =
        try {
            read()
        } catch (e: Exception) {
            null
        }

    /** JSON null instead of dropping the key. */
    private fun orNull(value: String?): Any = value ?: JSONObject.NULL

    private fun hex(value: Int): String = String.format("%02X", value)

    private fun shortName(device: UsbDevice): String =
        "${String.format("%04X", device.vendorId)}:${String.format("%04X", device.productId)} (${device.deviceName})"

    private fun deviceFromIntent(intent: Intent): UsbDevice? =
        IntentCompat.getParcelableExtra(intent, UsbManager.EXTRA_DEVICE, UsbDevice::class.java)

    // ---------------------------------------------------------------- events

    /**
     * All events go through the bridge thread, the same thread that handles addListener.
     * With retain = true an event waits until the page has registered a listener for it.
     */
    private fun emit(event: String, data: JSObject, retain: Boolean) {
        try {
            bridge.execute {
                try {
                    notifyListeners(event, data, retain)
                } catch (e: Exception) {
                    Log.e(TAG, "notifyListeners($event) failed", e)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "emit($event) failed", e)
        }
    }

    private fun log(message: String) {
        Log.i(TAG, message)
        val data = JSObject()
        data.put("message", message)
        emit("log", data, true)
    }

    private fun emitError(message: String) {
        Log.e(TAG, message)
        val data = JSObject()
        data.put("message", message)
        emit("error", data, true)
    }
}
