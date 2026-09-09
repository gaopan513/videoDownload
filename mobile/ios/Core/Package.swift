// swift-tools-version: 5.9
import PackageDescription
let package = Package(name:"HarborCore", platforms:[.macOS(.v13), .iOS(.v17)], products:[.library(name:"HarborCore",targets:["HarborCore"])], targets:[.target(name:"HarborCore",path:".",exclude:["Tests","Package.swift"]),.testTarget(name:"HarborCoreTests",dependencies:["HarborCore"],path:"Tests")])
