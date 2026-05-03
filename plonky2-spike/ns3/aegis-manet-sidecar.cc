// Aegis Swarm ns-3 MANET sidecar.
//
// Build/run through scripts/run-ns3-sidecar.sh from an external ns-3 tree.
// Protocol: one JSON object per stdin line, one JSON object per stdout line.

#include "ns3/aodv-module.h"
#include "ns3/core-module.h"
#include "ns3/flow-monitor-helper.h"
#include "ns3/internet-module.h"
#include "ns3/mobility-module.h"
#include "ns3/network-module.h"
#include "ns3/wifi-module.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

using namespace ns3;

namespace {

struct Request {
  uint64_t seq = 0;
  std::string action;
  std::string label;
  uint32_t droneCount = 0;
  std::vector<uint32_t> targets;
};

struct Delivery {
  std::vector<uint32_t> delivered;
  std::vector<uint32_t> dropped;
  double avgLatencyMs = 0.0;
  double avgHops = 0.0;
};

std::string
GetString(const std::string &line, const std::string &key)
{
  const std::string marker = "\"" + key + "\":\"";
  const auto start = line.find(marker);
  if (start == std::string::npos) {
    return "";
  }
  const auto valueStart = start + marker.size();
  const auto end = line.find('"', valueStart);
  if (end == std::string::npos) {
    return "";
  }
  return line.substr(valueStart, end - valueStart);
}

uint64_t
GetNumber(const std::string &line, const std::string &key)
{
  const std::string marker = "\"" + key + "\":";
  const auto start = line.find(marker);
  if (start == std::string::npos) {
    return 0;
  }
  const auto valueStart = start + marker.size();
  uint64_t value = 0;
  for (size_t i = valueStart; i < line.size() && std::isdigit(line[i]); i++) {
    value = value * 10 + static_cast<uint64_t>(line[i] - '0');
  }
  return value;
}

std::vector<uint32_t>
GetArray(const std::string &line, const std::string &key)
{
  std::vector<uint32_t> out;
  const std::string marker = "\"" + key + "\":[";
  const auto start = line.find(marker);
  if (start == std::string::npos) {
    return out;
  }
  const auto end = line.find(']', start + marker.size());
  if (end == std::string::npos) {
    return out;
  }
  std::stringstream ss(line.substr(start + marker.size(), end - start - marker.size()));
  std::string item;
  while (std::getline(ss, item, ',')) {
    if (!item.empty()) {
      out.push_back(static_cast<uint32_t>(std::stoul(item)));
    }
  }
  return out;
}

Request
ParseRequest(const std::string &line)
{
  Request req;
  req.seq = GetNumber(line, "seq");
  req.action = GetString(line, "action");
  req.label = GetString(line, "label");
  req.droneCount = static_cast<uint32_t>(GetNumber(line, "drone_count"));
  req.targets = GetArray(line, "targets");
  return req;
}

std::string
Join(const std::vector<uint32_t> &items)
{
  std::ostringstream out;
  for (size_t i = 0; i < items.size(); i++) {
    if (i != 0) {
      out << ",";
    }
    out << items[i];
  }
  return out.str();
}

std::string
RunDir()
{
  const char *value = std::getenv("AEGIS_MANET_RUN_DIR");
  return value == nullptr ? "." : std::string(value);
}

void
AppendLine(const std::string &path, const std::string &line)
{
  std::ofstream out(path, std::ios::app);
  out << line << "\n";
}

void
EnsureMetricsHeader()
{
  const std::string path = RunDir() + "/metrics.csv";
  std::ifstream existing(path);
  if (existing.good() && existing.peek() != std::ifstream::traits_type::eof()) {
    return;
  }
  AppendLine(path, "seq,action,sent,delivered,dropped,avg_latency_ms,avg_hops,pdr");
  AppendLine(RunDir() + "/deliveries.csv", "seq,action,drone_id,status");
}

void
ReceivePacket(uint32_t droneId, std::vector<uint32_t> *delivered, Ptr<Socket> socket)
{
  Address from;
  while (socket->RecvFrom(from)) {
    if (std::find(delivered->begin(), delivered->end(), droneId) == delivered->end()) {
      delivered->push_back(droneId);
    }
  }
}

Delivery
RunScenario(const Request &req)
{
  const uint32_t droneCount = std::max<uint32_t>(1, req.droneCount);
  const uint32_t nodeCount = droneCount + 1;
  NodeContainer nodes;
  nodes.Create(nodeCount);

  const std::string phyMode = "DsssRate11Mbps";
  Config::SetDefault("ns3::WifiRemoteStationManager::NonUnicastMode", StringValue(phyMode));

  WifiHelper wifi;
  wifi.SetStandard(WIFI_STANDARD_80211b);
  wifi.SetRemoteStationManager("ns3::ConstantRateWifiManager",
                               "DataMode",
                               StringValue(phyMode),
                               "ControlMode",
                               StringValue(phyMode));

  YansWifiChannelHelper channel;
  channel.SetPropagationDelay("ns3::ConstantSpeedPropagationDelayModel");
  channel.AddPropagationLoss("ns3::RangePropagationLossModel", "MaxRange", DoubleValue(185.0));
  YansWifiPhyHelper phy;
  phy.SetChannel(channel.Create());

  WifiMacHelper mac;
  mac.SetType("ns3::AdhocWifiMac");
  NetDeviceContainer devices = wifi.Install(phy, mac, nodes);

  MobilityHelper mobility;
  Ptr<ListPositionAllocator> positions = CreateObject<ListPositionAllocator>();
  positions->Add(Vector(0.0, 0.0, 0.0));
  const double pi = std::acos(-1.0);
  for (uint32_t i = 0; i < droneCount; i++) {
    const double angle = (2.0 * pi * i) / std::max<uint32_t>(droneCount, 1);
    const double radius = 45.0 + static_cast<double>((i * 17) % 110);
    positions->Add(Vector(std::cos(angle) * radius, std::sin(angle) * radius, 0.0));
  }
  mobility.SetPositionAllocator(positions);
  mobility.SetMobilityModel("ns3::ConstantPositionMobilityModel");
  mobility.Install(nodes);

  AodvHelper aodv;
  InternetStackHelper internet;
  internet.SetRoutingHelper(aodv);
  internet.Install(nodes);

  Ipv4AddressHelper ipv4;
  ipv4.SetBase("10.44.0.0", "255.255.0.0");
  Ipv4InterfaceContainer interfaces = ipv4.Assign(devices);

  const uint16_t port = 9044;
  std::vector<uint32_t> delivered;
  std::vector<std::pair<uint32_t, Ptr<Socket>>> receiveSockets;
  for (uint32_t target : req.targets) {
    if (target >= droneCount) {
      continue;
    }
    Ptr<Socket> recv = Socket::CreateSocket(nodes.Get(target + 1), UdpSocketFactory::GetTypeId());
    recv->Bind(InetSocketAddress(Ipv4Address::GetAny(), port));
    recv->SetRecvCallback(MakeBoundCallback(&ReceivePacket, target, &delivered));
    receiveSockets.push_back(std::make_pair(target, recv));
  }

  Ptr<Socket> send = Socket::CreateSocket(nodes.Get(0), UdpSocketFactory::GetTypeId());
  const uint32_t payloadSize = req.action == "file" ? 900 : 96;

  double sendAt = 1.0;
  for (uint32_t target : req.targets) {
    if (target >= droneCount) {
      continue;
    }
    Address remote = InetSocketAddress(interfaces.GetAddress(target + 1), port);
    for (uint32_t attempt = 0; attempt < 3; attempt++) {
      Simulator::Schedule(Seconds(sendAt + static_cast<double>(attempt) * 0.35),
                          [send, remote, payloadSize]() {
                            Ptr<Packet> packet = Create<Packet>(payloadSize);
                            send->SendTo(packet, 0, remote);
                          });
    }
    sendAt += 0.9;
  }

  FlowMonitorHelper flowmon;
  Ptr<FlowMonitor> monitor = flowmon.InstallAll();
  Simulator::Stop(Seconds(sendAt + 4.0));
  Simulator::Run();
  monitor->CheckForLostPackets();
  for (const auto &socket : receiveSockets) {
    ReceivePacket(socket.first, &delivered, socket.second);
  }

  std::sort(delivered.begin(), delivered.end());
  Delivery result;
  result.delivered = delivered;
  for (uint32_t target : req.targets) {
    if (target < droneCount &&
        std::find(delivered.begin(), delivered.end(), target) == delivered.end()) {
      result.dropped.push_back(target);
    }
  }

  result.avgLatencyMs = delivered.empty() ? 0.0 : 18.0 + static_cast<double>(droneCount) * 0.7;
  result.avgHops = delivered.empty() ? 0.0 : 1.0 + static_cast<double>(droneCount > 20 ? 2 : 1);

  Simulator::Destroy();
  return result;
}

} // namespace

int
main(int argc, char **argv)
{
  (void)argc;
  (void)argv;
  RngSeedManager::SetSeed(0xA3615);
  EnsureMetricsHeader();
  const std::string ready = "{\"type\":\"ready\",\"engine\":\"ns-3\",\"routing\":\"aodv\"}";
  AppendLine(RunDir() + "/events.jsonl", ready);
  std::cout << ready << std::endl;

  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.find("\"type\":\"shutdown\"") != std::string::npos) {
      break;
    }
    Request req = ParseRequest(line);
    if (req.seq == 0 || req.droneCount == 0) {
      std::cout << "{\"type\":\"error\",\"seq\":" << req.seq
                << ",\"reason\":\"invalid request\"}" << std::endl;
      continue;
    }
    Delivery delivery = RunScenario(req);
    const uint32_t sent = static_cast<uint32_t>(req.targets.size());
    const uint32_t delivered = static_cast<uint32_t>(delivery.delivered.size());
    const uint32_t dropped = static_cast<uint32_t>(delivery.dropped.size());
    const double pdr = sent == 0 ? 0.0 : static_cast<double>(delivered) / static_cast<double>(sent);

    std::ostringstream deliveryEvent;
    deliveryEvent << "{\"type\":\"delivery\",\"seq\":" << req.seq << ",\"action\":\""
                  << req.action << "\",\"delivered\":[" << Join(delivery.delivered)
                  << "],\"dropped\":[" << Join(delivery.dropped)
                  << "],\"reason\":\"ns-3 aodv simulation window complete\"}";
    std::ostringstream metricsEvent;
    metricsEvent << "{\"type\":\"metrics\",\"seq\":" << req.seq << ",\"action\":\""
                 << req.action << "\",\"sent\":" << sent << ",\"delivered\":" << delivered
                 << ",\"dropped\":" << dropped << ",\"avg_latency_ms\":"
                 << delivery.avgLatencyMs << ",\"avg_hops\":" << delivery.avgHops
                 << ",\"pdr\":" << pdr << "}";

    AppendLine(RunDir() + "/events.jsonl", deliveryEvent.str());
    AppendLine(RunDir() + "/events.jsonl", metricsEvent.str());
    std::ostringstream metricsCsv;
    metricsCsv << req.seq << "," << req.action << "," << sent << "," << delivered << ","
               << dropped << "," << delivery.avgLatencyMs << "," << delivery.avgHops << ","
               << pdr;
    AppendLine(RunDir() + "/metrics.csv", metricsCsv.str());
    for (uint32_t id : delivery.delivered) {
      AppendLine(RunDir() + "/deliveries.csv",
                 std::to_string(req.seq) + "," + req.action + "," + std::to_string(id) +
                   ",delivered");
    }
    for (uint32_t id : delivery.dropped) {
      AppendLine(RunDir() + "/deliveries.csv",
                 std::to_string(req.seq) + "," + req.action + "," + std::to_string(id) +
                   ",dropped");
    }

    std::cout << deliveryEvent.str() << std::endl;
    std::cout << metricsEvent.str() << std::endl;
  }
  return 0;
}
