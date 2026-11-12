package id.alhuda.dnet;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RosSocketPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
