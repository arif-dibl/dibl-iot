# 🚀 সিকিউর মাল্টি-CA অটো-প্রভিশনিং ওয়াকথ্রু (Walkthrough)

এই গাইডটি আপনাকে ধাপে ধাপে দেখাবে কীভাবে সার্ভার ক্র্যাশ না করে নিরাপদে একাধিক CA (Certificate Authority) দিয়ে OpenRemote অটো-প্রভিশনিং সেটআপ করবেন।

---

## 📌 ধাপ ১: `docker-compose.coolify.yml` ঠিক করা (HAProxy আপডেট)

আপনার আগের কনফিগারেশনে ১১টি CA একসাথে থাকায় সার্ভার ক্র্যাশ করছিল। আমরা এখন শুধু **একটি RootCA** রাখবো এবং সিকিউরিটি সেটিংস উন্নত করবো।

### ১.১. CA বান্ডেল ছোট করা
আপনার `docker-compose.coolify.yml` ফাইল থেকে ১১টি CA মুছে ফেলুন। সেখানে শুধু আপনার প্রধান `rootCA.pem`-এর কন্টেন্ট রাখুন।

### ১.২. HAProxy কনফিগারেশন আরও নিরাপদ করা
`docker-compose.coolify.yml`-এর একদম শুরুতে `haproxy-config` ব্লকের `frontend mqtt` অংশটি নিচের মতো করে আপডেট করুন:

```haproxy
      # MQTT TLS Frontend with mTLS (উন্নত নিরাপত্তা)
      frontend mqtt
          # শুধুমাত্র TLS v1.2 বা তার উপরের ভার্সন অ্যালাউ করবে এবং Session Tickets বন্ধ রাখবে
          bind *:8883 ssl crt /certs/mqtt-server-combined.pem ca-file /certs/ca.pem verify required no-tls-tickets ssl-min-ver TLSv1.2
          mode tcp
          default_backend mqtt_backend

      backend mqtt_backend
          mode tcp
          # MQTT-এর জন্য দীর্ঘ টাইমআউট এবং আইডল কানেকশন জিইয়ে রাখার অপশন
          option clitcpka
          timeout client 3h
          timeout server 3h
          timeout tunnel 300s
```

> [!TIP]
> **কেন এই পরিবর্তন?** `clitcpka` এবং `3h` টাইমআউট IoT ডিভাইসের কানেকশন বারবার ড্রপ হওয়া বন্ধ করবে। `no-tls-tickets` এবং `ssl-min-ver` হ্যাকিংয়ের ঝুঁকি কমাবে।

---

## 📌 ধাপ ২: OpenRemote Manager-এ একাধিক CA সেটআপ

যেহেতু প্রক্সিতে (HAProxy) আমরা শুধু একটি RootCA রেখেছি, তাই বাকি CA-গুলো (যেমন: `valve_CA`, `sens_CA`) আমরা সরাসরি OpenRemote Manager-এর ভেতর যোগ করবো।

### ২.১. Manager UI-তে লগইন করুন
- আপনার OpenRemote ড্যাশবোর্ডে (`master.senspanel.com`) অ্যাডমিন হিসেবে লগইন করুন।
- উপরের ডানদিকের মেনু থেকে **Auto Provisioning**-এ ক্লিক করুন।

### ২.২. প্রতিটি ক্যাটাগরির জন্য Provisioning Config তৈরি করুন
আপনার প্রতিটি ডিভাইসের ক্যাটাগরির জন্য আলাদা করে একটি নিয়ম (Rule) তৈরি করতে হবে।

1. **Add Provisioning Config**-এ ক্লিক করুন।
2. **Name:** একটি নাম দিন (যেমন: `Farmhub Devices`)।
3. **Type:** `X.509` সিলেক্ট করুন।
4. **CA Certificate (PEM):** এখানে আপনার `farmhub_CA.pem` ফাইলের ভেতরের টেক্সট কপি করে পেস্ট করুন।
5. **Asset Template:** `FarmhubAsset` (বা আপনার তৈরি করা টেমপ্লেট) সিলেক্ট করুন।
6. **Save** করুন।

এভাবে আপনার ১০টি ক্যাটাগরির (Valve, Sensor, Switch ইত্যাদি) জন্য ১০ বার এই ধাপগুলো অনুসরণ করে আলাদা কনফিগারেশন তৈরি করুন।

> [!IMPORTANT]
> **সাবধানতা:** এখানে কোনোভাবেই Private Key পেস্ট করবেন না। শুধুমাত্র Public CA Certificate (`-----BEGIN CERTIFICATE-----` থেকে `-----END CERTIFICATE-----` পর্যন্ত) দেবেন।

---

## 📌 ধাপ ৩: টেস্টিং (Verification)

সবকিছু ঠিকমতো কাজ করছে কি না, তা যাচাই করার জন্য টার্মিনাল থেকে একটি টেস্ট করুন।

```bash
# SetInsecure=False দিয়ে Python স্ক্রিপ্ট রান করুন
python3 /home/arif-dibl/Desktop/Arif_Projects/Arduino/prototype_02/update_certificates/setup_device_gui.py
```

### কী ফলাফল আশা করবেন?
1. **HAProxy লেভেল:** ডিভাইসটি মেইন RootCA (যা docker-compose-এ দিয়েছেন) দ্বারা ভেরিফাই হয়ে গেট পার হবে।
2. **Manager লেভেল:** OpenRemote Manager কানেকশনটি রিসিভ করে এর ভেতরের `farmhub_CA` বা নির্দিষ্ট CA চেক করবে এবং সফলভাবে অটো-প্রভিশনিং সম্পন্ন করবে।
3. আপনি টার্মিনালে Provisioning Success মেসেজ দেখতে পাবেন।

> [!NOTE]
> **সারসংক্ষেপ:** এই পদ্ধতিতে HAProxy-এর ওপর প্রেশার কমে যায় (সার্ভার আর ক্র্যাশ করবে না) এবং OpenRemote Manager-এর বিল্ট-ইন মাল্টি-টেন্যান্ট সিকিউরিটির পূর্ণ ব্যবহার হয়। এটিই সবচেয়ে স্মার্ট ও রিলায়েবল পদ্ধতি!
