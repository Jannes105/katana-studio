package io.github.jannes105.katanastudio.usbtest

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Must happen before super.onCreate(), which builds the bridge.
        registerPlugin(KatanaUsbPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
