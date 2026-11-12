package id.alhuda.dnet;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.view.View;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Soket TCP untuk API RouterOS (port 8728).
 * JavaScript mengirim satu "sentence" (daftar kata), plugin menulis ke router
 * lalu membaca balasan sampai !done, dan mengembalikan semua sentence balasan.
 */
@CapacitorPlugin(name = "RosSocket")
public class RosSocketPlugin extends Plugin {

    private final Map<Integer, Socket> sockets = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger(1);
    private final ExecutorService pool = Executors.newCachedThreadPool();

    @PluginMethod
    public void connect(final PluginCall call) {
        final String host = call.getString("host", "");
        final int port = call.getInt("port", 8728);
        final int timeout = call.getInt("timeout", 6000);
        pool.execute(() -> {
            try {
                Socket s = new Socket();
                s.connect(new InetSocketAddress(host, port), timeout);
                s.setSoTimeout(timeout);
                s.setTcpNoDelay(true);
                int id = seq.getAndIncrement();
                sockets.put(id, s);
                JSObject r = new JSObject();
                r.put("id", id);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Tidak dapat terhubung ke MikroTik " + host + ":" + port + " (" + e.getMessage() + ")");
            }
        });
    }

    @PluginMethod
    public void talk(final PluginCall call) {
        final int id = call.getInt("id", 0);
        final JSArray words = call.getArray("words");
        pool.execute(() -> {
            Socket s = sockets.get(id);
            if (s == null) { call.reject("Koneksi ke MikroTik sudah tertutup"); return; }
            try {
                JSArray out = new JSArray();
                synchronized (s) {
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    for (int i = 0; i < words.length(); i++) {
                        byte[] w = words.getString(i).getBytes(StandardCharsets.UTF_8);
                        writeLen(buf, w.length);
                        buf.write(w);
                    }
                    buf.write(0);
                    OutputStream os = s.getOutputStream();
                    os.write(buf.toByteArray());
                    os.flush();

                    DataInputStream in = new DataInputStream(s.getInputStream());
                    while (true) {
                        List<String> sentence = readSentence(in);
                        if (sentence.isEmpty()) continue;
                        JSArray ja = new JSArray();
                        for (String w : sentence) ja.put(w);
                        out.put(ja);
                        String type = sentence.get(0);
                        if (type.equals("!done") || type.equals("!fatal")) break;
                    }
                }
                JSObject r = new JSObject();
                r.put("sentences", out);
                call.resolve(r);
            } catch (Exception e) {
                closeQuiet(id);
                call.reject("Koneksi MikroTik terputus: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        closeQuiet(call.getInt("id", 0));
        call.resolve();
    }

    /** IP perangkat (wifi) — dipakai untuk login hotspot otomatis lewat API */
    @PluginMethod
    public void localIp(PluginCall call) {
        String found = "";
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) {
                        String ip = a.getHostAddress();
                        if (ni.getName().startsWith("wlan")) { found = ip; break; }
                        if (found.isEmpty()) found = ip;
                    }
                }
                if (ni.getName().startsWith("wlan") && !found.isEmpty()) break;
            }
        } catch (Exception ignored) { }
        JSObject r = new JSObject();
        r.put("ip", found);
        call.resolve(r);
    }

    /** Tinggi status bar (area jam) & navigation bar dalam px CSS */
    @PluginMethod
    public void insets(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            int top = 0, bottom = 0;
            try {
                View v = getBridge().getWebView();
                WindowInsetsCompat wi = ViewCompat.getRootWindowInsets(v);
                if (wi != null) {
                    Insets in = wi.getInsets(WindowInsetsCompat.Type.systemBars());
                    float d = getContext().getResources().getDisplayMetrics().density;
                    top = Math.round(in.top / d);
                    bottom = Math.round(in.bottom / d);
                }
            } catch (Exception ignored) { }
            JSObject r = new JSObject();
            r.put("top", top);
            r.put("bottom", bottom);
            call.resolve(r);
        });
    }

    /** Warna ikon jam/baterai: gelap (untuk tema terang) atau putih */
    @PluginMethod
    public void setSystemBars(final PluginCall call) {
        final boolean darkIcons = call.getBoolean("darkIcons", false);
        getActivity().runOnUiThread(() -> {
            try {
                Window w = getActivity().getWindow();
                WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
                c.setAppearanceLightStatusBars(darkIcons);
                c.setAppearanceLightNavigationBars(darkIcons);
            } catch (Exception ignored) { }
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        for (Integer id : new ArrayList<>(sockets.keySet())) closeQuiet(id);
        pool.shutdownNow();
    }

    private void closeQuiet(int id) {
        Socket s = sockets.remove(id);
        if (s != null) { try { s.close(); } catch (IOException ignored) { } }
    }

    private static void writeLen(ByteArrayOutputStream b, int l) {
        if (l < 0x80) { b.write(l); }
        else if (l < 0x4000) { l |= 0x8000; b.write((l >> 8) & 0xFF); b.write(l & 0xFF); }
        else if (l < 0x200000) { l |= 0xC00000; b.write((l >> 16) & 0xFF); b.write((l >> 8) & 0xFF); b.write(l & 0xFF); }
        else if (l < 0x10000000) { l |= 0xE0000000; b.write((l >> 24) & 0xFF); b.write((l >> 16) & 0xFF); b.write((l >> 8) & 0xFF); b.write(l & 0xFF); }
        else { b.write(0xF0); b.write((l >> 24) & 0xFF); b.write((l >> 16) & 0xFF); b.write((l >> 8) & 0xFF); b.write(l & 0xFF); }
    }

    private static int readLen(DataInputStream in) throws IOException {
        int b = in.readUnsignedByte();
        if ((b & 0x80) == 0) return b;
        if ((b & 0xC0) == 0x80) return ((b & 0x3F) << 8) | in.readUnsignedByte();
        if ((b & 0xE0) == 0xC0) return ((b & 0x1F) << 16) | (in.readUnsignedByte() << 8) | in.readUnsignedByte();
        if ((b & 0xF0) == 0xE0) return ((b & 0x0F) << 24) | (in.readUnsignedByte() << 16) | (in.readUnsignedByte() << 8) | in.readUnsignedByte();
        return in.readInt();
    }

    private static List<String> readSentence(DataInputStream in) throws IOException {
        List<String> words = new ArrayList<>();
        while (true) {
            int len = readLen(in);
            if (len == 0) break;
            byte[] w = new byte[len];
            in.readFully(w);
            words.add(new String(w, StandardCharsets.UTF_8));
        }
        return words;
    }
}
