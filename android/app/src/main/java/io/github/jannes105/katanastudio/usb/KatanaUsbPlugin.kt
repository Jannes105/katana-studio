package io.github.jannes105.katanastudio.usb

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
 * Raw USB access to the BOSS Katana Gen 3 (PLAN 4.2). The amp is a vendor-specific device, not a USB-MIDI
 * class device, so Android does not offer it as MIDI; this plugin talks to the USB host API directly and only
 * moves bytes. Packing SysEx into USB-MIDI packets and unpacking them happens in TypeScript (src/midi/).
 *
 * Interface for JavaScript: open(), close(), send({ bytes }), getStatus(), listDevices();
 * events "data" ({ bytes }), "attached" ({ device }), "detached" ({ wasOpen }), "error" ({ message }),
 * "log" ({ message }).
 *
 * Duties from PLAN 4.2, all handled here:
 *  - only the MIDI interface is claimed (vendor class, IN and OUT bulk or interrupt, no isochronous endpoint);
 *    the audio interfaces stay untouched. claimInterface(force = true) is required, the kernel holds it.
 *    Measured values (interface 3, alt 0, OUT 0x03, IN 0x84) are only checked and logged, not hard-coded.
 *  - bulk and interrupt endpoints both work (bulkTransfer serves both)
 *  - IN transfers run on their own read thread
 *  - permission: the manifest filter VID 0x0582 / PID 0x02F0 makes Android ask once ("always open with
 *    this app"); requestPermission uses an explicit, mutable PendingIntent
 *  - USB_DEVICE_DETACHED is registered at runtime with RECEIVER_NOT_EXPORTED
 *  - launchMode singleTask: plugging in while the app runs arrives through onNewIntent
 *
 * Threads: plugin methods arrive on the bridge thread and return at once; open/close/send run on [io]
 * (one thread, so they never overlap); the read loop has its own thread; broadcasts arrive on the main
 * thread. Everything that describes the open connection is guarded by [lock].
 */
@CapacitorPlugin(name = "KatanaUsb")
class KatanaUsbPlugin : Plugin() {

    companion object {
        private const val TAG = "KatanaUsb"
        const val KATANA_VENDOR_ID = 0x0582
        const val KATANA_PRODUCT_ID = 0x02F0
        private const val EXPECTED_INTERFACE = 3
        private const val EXPECTED_ALT = 0
        private const val EXPECTED_OUT = 0x03
        private const val EXPECTED_IN = 0x84
        private const val READ_TIMEOUT_MS = 100
        private const val WRITE_TIMEOUT_MS = 1000
    }

    private lateinit var usbManager: UsbManager
    private lateinit var permissionAction: String
    private val io: ExecutorService = Executors.newSingleThreadExecutor()

    private val lock = Any()
    private var connection: UsbDeviceConnection? = null
    private var openDevice: UsbDevice? = null
    private var claimedInterface: UsbInterface? = null
    private var outEndpoint: UsbEndpoint? = null
    private var openInfo: JSObject? = null
    private var readThread: Thread? = null
    private var pendingOpen: PluginCall? = null

    @Volatile
    private var reading = false
    private var receiverRegistered = false
    private var lastAttachIntent: Intent? = null

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            try {
                when (intent.action) {
                    permissionAction -> onPermissionResult(intent)
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
        permissionAction = "${context.packageName}.USB_PERMISSION"
        val filter = IntentFilter()
        filter.addAction(permissionAction)
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        // NOT_EXPORTED still lets system broadcasts through (detach, and the permission answer for our own
        // PendingIntent); other apps are kept out. ContextCompat picks the right call for every API level.
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        receiverRegistered = true
        log("Plugin loaded (Android API ${Build.VERSION.SDK_INT})")
        // Cold start by plugging in: the attach intent is the launch intent, onNewIntent never fires for it.
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    override fun handleOnNewIntent(intent: Intent) {
        try {
            if (intent.action != UsbManager.ACTION_USB_DEVICE_ATTACHED) return
            // On a cold start both load() and Capacitor hand over the same launch intent (seen on the phone).
            if (intent === lastAttachIntent) return
            lastAttachIntent = intent
            val device = deviceFromIntent(intent)
            if (device == null || !isKatana(device)) return
            log("Attached: ${shortName(device)}, permission=${usbManager.hasPermission(device)}")
            val data = JSObject()
            data.put("device", describeDevice(device))
            // Retained: a cold start fires this before the page has registered its listener.
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

    /** Opens the Katana (asks for permission if needed). Resolves at once if it is already open. */
    @PluginMethod
    fun open(call: PluginCall) {
        try {
            val device = findKatana()
            if (device == null) {
                call.reject("No KATANA attached (${usbManager.deviceList.size} USB device(s) visible)", "NOT_ATTACHED")
                return
            }
            if (usbManager.hasPermission(device)) {
                runOpen(call, device)
                return
            }
            val older = synchronized(lock) {
                val previous = pendingOpen
                pendingOpen = call
                previous
            }
            older?.reject("Replaced by a newer open() call", "REPLACED")
            log("Asking for USB permission for ${shortName(device)}")
            // Explicit (setPackage) and mutable: the system adds the device and the answer as extras.
            val intent = Intent(permissionAction).setPackage(context.packageName)
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
            usbManager.requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, flags))
        } catch (e: Exception) {
            synchronized(lock) { if (pendingOpen === call) pendingOpen = null }
            call.reject("open failed: $e", "OPEN_FAILED")
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

    /** Sends raw bytes (complete USB-MIDI packets) to the OUT endpoint. Resolves when all bytes are written. */
    @PluginMethod
    fun send(call: PluginCall) {
        try {
            val array = call.getArray("bytes")
            if (array == null) {
                call.reject("send needs { bytes: number[] }")
                return
            }
            val bytes = ByteArray(array.length())
            for (i in bytes.indices) bytes[i] = (array.getInt(i) and 0xFF).toByte()
            io.execute {
                try {
                    val (c, e) = synchronized(lock) { Pair(connection, outEndpoint) }
                    if (c == null || e == null) {
                        call.reject("Not open", "NOT_OPEN")
                        return@execute
                    }
                    // bulkTransfer serves interrupt endpoints too. It may write less than asked: repeat.
                    var offset = 0
                    while (offset < bytes.size) {
                        val written = c.bulkTransfer(e, bytes, offset, bytes.size - offset, WRITE_TIMEOUT_MS)
                        if (written <= 0) {
                            call.reject("Send failed: bulkTransfer returned $written after $offset of ${bytes.size} byte(s)", "SEND_FAILED")
                            return@execute
                        }
                        offset += written
                    }
                    val result = JSObject()
                    result.put("written", offset)
                    call.resolve(result)
                } catch (ex: Exception) {
                    call.reject("send failed: $ex", "SEND_FAILED")
                }
            }
        } catch (e: Exception) {
            call.reject("send failed: $e", "SEND_FAILED")
        }
    }

    /** Whether a KATANA is attached and whether it is open (the page may have reloaded while it was open). */
    @PluginMethod
    fun getStatus(call: PluginCall) {
        try {
            val device = findKatana()
            val result = JSObject()
            result.put("attached", device != null)
            result.put("hasPermission", device != null && usbManager.hasPermission(device))
            val info = synchronized(lock) { openInfo }
            result.put("open", info != null)
            if (info != null) result.put("info", info)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("getStatus failed: $e")
        }
    }

    /** Every attached USB device with interfaces and endpoints (diagnostics for the log screen). */
    @PluginMethod
    fun listDevices(call: PluginCall) {
        try {
            val devices = JSArray()
            for (device in usbManager.deviceList.values) devices.put(describeDevice(device))
            val result = JSObject()
            result.put("devices", devices)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("listDevices failed: $e")
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
            call?.reject("USB permission denied", "PERMISSION_DENIED")
        }
    }

    private fun onDetached(intent: Intent) {
        val device = deviceFromIntent(intent)
        val wasOpen = synchronized(lock) {
            val current = openDevice
            current != null && (device == null || device.deviceName == current.deviceName)
        }
        if (!wasOpen && (device == null || !isKatana(device))) return // some other USB device
        log("Detached: " + (device?.let { shortName(it) } ?: "unknown device") + ", wasOpen=$wasOpen")
        if (wasOpen) closeInternal("device detached")
        val data = JSObject()
        data.put("wasOpen", wasOpen)
        emit("detached", data, false)
    }

    // ---------------------------------------------------------------- open / close

    private fun runOpen(call: PluginCall, device: UsbDevice) {
        try {
            io.execute {
                try {
                    doOpen(call, device)
                } catch (e: Exception) {
                    emitError("open failed: $e")
                    call.reject("open failed: $e", "OPEN_FAILED")
                }
            }
        } catch (e: Exception) {
            call.reject("open failed: $e", "OPEN_FAILED")
        }
    }

    private fun doOpen(call: PluginCall, device: UsbDevice) {
        // Already open on this device (auto-open and a manual open racing): nothing to do.
        val existing = synchronized(lock) {
            if (openDevice?.deviceName == device.deviceName && reading) openInfo else null
        }
        if (existing != null) {
            call.resolve(existing)
            return
        }
        closeInternal("re-open")

        val intf = pickInterface(device)
        if (intf == null) {
            call.reject("No usable interface: need one with an IN and an OUT endpoint (bulk or interrupt) and no isochronous endpoint", "NO_INTERFACE")
            return
        }
        val inEp = pickEndpoint(intf, UsbConstants.USB_DIR_IN)
        val outEp = pickEndpoint(intf, UsbConstants.USB_DIR_OUT)
        if (inEp == null || outEp == null) {
            call.reject("Interface ${intf.id} lacks an IN or OUT endpoint", "NO_INTERFACE")
            return
        }
        log(
            "Chosen: interface ${intf.id} alt ${intf.alternateSetting} class 0x${hex(intf.interfaceClass)}, " +
                "IN 0x${hex(inEp.address)} (${typeName(inEp.type)}, ${inEp.maxPacketSize} bytes), " +
                "OUT 0x${hex(outEp.address)} (${typeName(outEp.type)}, ${outEp.maxPacketSize} bytes)"
        )
        if (intf.id != EXPECTED_INTERFACE || intf.alternateSetting != EXPECTED_ALT ||
            inEp.address != EXPECTED_IN || outEp.address != EXPECTED_OUT
        ) {
            emitError(
                "USB layout differs from the measured one (interface 3 alt 0, OUT 0x03, IN 0x84); continuing " +
                    "with the auto-picked values. Please report this with the log."
            )
        }

        val conn = usbManager.openDevice(device)
        if (conn == null) {
            call.reject("openDevice returned null", "OPEN_FAILED")
            return
        }
        // force = true takes the interface away from the kernel driver (snd-usb-audio), which holds it.
        val claimed = conn.claimInterface(intf, true)
        log("claimInterface(force) -> $claimed")
        if (!claimed) {
            conn.close()
            call.reject("claimInterface failed for interface ${intf.id}", "CLAIM_FAILED")
            return
        }
        val altOk = conn.setInterface(intf)
        log("setInterface(alt ${intf.alternateSetting}) -> $altOk")
        if (!altOk) {
            // Not fatal: some devices refuse the request for alternate setting 0 although it is active.
            emitError("setInterface failed for alt ${intf.alternateSetting}, trying to continue")
        }

        val info = JSObject()
        info.put("interfaceId", intf.id)
        info.put("alternateSetting", intf.alternateSetting)
        info.put("inEndpoint", describeEndpoint(inEp))
        info.put("outEndpoint", describeEndpoint(outEp))
        info.put("setInterfaceOk", altOk)

        synchronized(lock) {
            connection = conn
            openDevice = device
            claimedInterface = intf
            outEndpoint = outEp
            openInfo = info
            reading = true
            val thread = Thread({ readLoop(conn, inEp) }, "KatanaUsbRead")
            readThread = thread
            thread.start()
        }
        log("Open")
        call.resolve(info)
    }

    /** Stops the read thread, releases the interface and closes the connection. Safe to call twice. */
    private fun closeInternal(reason: String) {
        val (conn, intf, thread) = synchronized(lock) {
            val state = Triple(connection, claimedInterface, readThread)
            connection = null
            openDevice = null
            claimedInterface = null
            outEndpoint = null
            openInfo = null
            readThread = null
            reading = false
            state
        }
        val c = conn ?: return
        log("Closing ($reason)")
        try {
            if (thread != null && thread !== Thread.currentThread()) thread.join(500)
        } catch (e: Exception) {
            Log.w(TAG, "join failed", e)
        }
        try {
            if (intf != null) log("releaseInterface -> ${c.releaseInterface(intf)}")
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
        // A multiple of maxPacketSize, at least 8 packets and at least 512 bytes.
        val packet = maxOf(ep.maxPacketSize, 1)
        val buffer = ByteArray(packet * maxOf(8, (511 + packet) / packet))
        log("Read thread started (buffer ${buffer.size} bytes)")
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
                    // -1 after the full timeout is normal (nothing to read). -1 that comes back at once means
                    // the transfer itself fails, e.g. the device is gone before the detach broadcast arrived.
                    if (SystemClock.elapsedRealtime() - started < READ_TIMEOUT_MS / 2) {
                        quickFailures++
                        if (quickFailures == 50) emitError("IN transfers keep failing immediately (device gone?)")
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

    private fun isKatana(device: UsbDevice): Boolean =
        device.vendorId == KATANA_VENDOR_ID && device.productId == KATANA_PRODUCT_ID

    private fun findKatana(): UsbDevice? = usbManager.deviceList.values.firstOrNull { isKatana(it) }

    private fun isBulkOrInterrupt(ep: UsbEndpoint): Boolean =
        ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK || ep.type == UsbConstants.USB_ENDPOINT_XFER_INT

    private fun endpoints(intf: UsbInterface): List<UsbEndpoint> =
        (0 until intf.endpointCount).map { intf.getEndpoint(it) }

    /** The first bulk (else interrupt) endpoint in that direction. */
    private fun pickEndpoint(intf: UsbInterface, direction: Int): UsbEndpoint? {
        val candidates = endpoints(intf).filter { it.direction == direction && isBulkOrInterrupt(it) }
        return candidates.firstOrNull { it.type == UsbConstants.USB_ENDPOINT_XFER_BULK } ?: candidates.firstOrNull()
    }

    /**
     * Every alternate setting is its own UsbInterface object. Usable is one with an IN and an OUT endpoint
     * (bulk or interrupt) and no isochronous endpoint, so audio stays untouched. Vendor class (0xFF) wins,
     * then bulk over interrupt (alt 0 before alt 1 on the Katana), then descriptor order.
     */
    private fun pickInterface(device: UsbDevice): UsbInterface? {
        val usable = ArrayList<UsbInterface>()
        for (i in 0 until device.interfaceCount) {
            val intf = device.getInterface(i)
            val eps = endpoints(intf)
            val isochronous = eps.any { it.type == UsbConstants.USB_ENDPOINT_XFER_ISOC }
            val complete = pickEndpoint(intf, UsbConstants.USB_DIR_IN) != null &&
                pickEndpoint(intf, UsbConstants.USB_DIR_OUT) != null
            if (complete && !isochronous) usable.add(intf)
        }
        val vendor = usable.filter { it.interfaceClass == UsbConstants.USB_CLASS_VENDOR_SPEC }.ifEmpty { usable }
        return vendor.firstOrNull { intf -> endpoints(intf).all { it.type == UsbConstants.USB_ENDPOINT_XFER_BULK } }
            ?: vendor.firstOrNull()
    }

    // ---------------------------------------------------------------- describing things for JavaScript

    private fun describeDevice(device: UsbDevice): JSObject {
        val o = JSObject()
        o.put("deviceName", device.deviceName)
        o.put("vendorId", device.vendorId)
        o.put("productId", device.productId)
        o.put("deviceClass", device.deviceClass)
        o.put("manufacturerName", orNull(safeString { device.manufacturerName }))
        o.put("productName", orNull(safeString { device.productName }))
        o.put("hasPermission", try { usbManager.hasPermission(device) } catch (e: Exception) { false })
        val interfaces = JSArray()
        for (i in 0 until device.interfaceCount) {
            val intf = device.getInterface(i)
            val item = JSObject()
            item.put("id", intf.id)
            item.put("alternateSetting", intf.alternateSetting)
            item.put("interfaceClass", intf.interfaceClass)
            item.put("interfaceSubclass", intf.interfaceSubclass)
            item.put("interfaceProtocol", intf.interfaceProtocol)
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
        o.put("direction", if (ep.direction == UsbConstants.USB_DIR_IN) "in" else "out")
        o.put("type", typeName(ep.type))
        o.put("maxPacketSize", ep.maxPacketSize)
        return o
    }

    private fun typeName(type: Int): String = when (type) {
        UsbConstants.USB_ENDPOINT_XFER_BULK -> "bulk"
        UsbConstants.USB_ENDPOINT_XFER_INT -> "interrupt"
        UsbConstants.USB_ENDPOINT_XFER_ISOC -> "isochronous"
        else -> "control"
    }

    /** Device strings throw SecurityException without permission on some Android versions. */
    private fun safeString(read: () -> String?): String? = try { read() } catch (e: Exception) { null }

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
