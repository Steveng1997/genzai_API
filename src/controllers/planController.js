const dynamoDB = require("../services/dynamo");
const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const TABLE_NAME = process.env.DYNAMODB_TABLE_PLANS || "PlanDefinitions";

const getAllPlans = async (req, res) => {
  try {
    const data = await dynamoDB.send(
      new ScanCommand({ TableName: TABLE_NAME }),
    );
    res.status(200).json(data.Items);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching plans", error: error.message });
  }
};

const getPlanById = async (planId) => {
  try {
    const data = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { planId: planId },
      }),
    );
    return data.Item;
  } catch (error) {
    console.error("Error fetching plan by ID:", error);
    return null;
  }
};

module.exports = { getAllPlans, getPlanById };